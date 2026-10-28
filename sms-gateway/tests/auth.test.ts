import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { SignJWT, jwtVerify } from "jose";
import { createAuthController } from "../src/modules/auth/auth.controller.js";
import { createAuthRouter } from "../src/modules/auth/auth.routes.js";
import { createAuthMiddleware } from "../src/middlewares/auth.middleware.js";
import { errorHandler } from "../src/middlewares/error-handler.js";

const TEST_SECRET = "test-only-secret-for-auth-tests-123456";

class FakeDatabase {
  private users = new Map<
    string,
    { id: string; email: string; password: string; balance: number }
  >();

  async findUserByEmail(email: string) {
    const user = this.users.get(email);
    if (!user) {
      return null;
    }

    return { id: user.id, email: user.email, password: user.password };
  }

  async createUserAndWallet(
    email: string,
    passwordHash: string,
    initialBalance: number,
  ) {
    if (this.users.has(email)) {
      throw Object.assign(new Error("Duplicate email"), { code: "P2002" });
    }

    const user = {
      id: `test-user-${this.users.size + 1}`,
      email,
      password: passwordHash,
      balance: initialBalance,
    };
    this.users.set(email, user);

    return {
      id: user.id,
      email: user.email,
      wallet: { balance: user.balance },
    };
  }
}

async function startTestServer(database = new FakeDatabase()) {
  const app = express();
  const controller = createAuthController(database, TEST_SECRET);

  app.use(express.json());
  app.use("/auth", createAuthRouter(controller));
  app.get("/protected", createAuthMiddleware(TEST_SECRET), (req, res) => {
    res.json({ userId: req.auth?.userId });
  });
  app.use(errorHandler);

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not start.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function postJson(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("register normalizes email, hashes password, and creates 100 credits", async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const response = await postJson(server.baseUrl, "/auth/register", {
    email: "  User@Example.com ",
    password: "Password123",
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    message: "Registration successful.",
    user: {
      id: "test-user-1",
      email: "user@example.com",
      walletBalance: 100,
    },
  });
});

test("register returns 409 for a duplicate email", async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  await postJson(server.baseUrl, "/auth/register", {
    email: "user@example.com",
    password: "Password123",
  });
  const response = await postJson(server.baseUrl, "/auth/register", {
    email: " USER@example.com ",
    password: "Password123",
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { message: "Email is already registered." },
  });
});

test("login returns a valid JWT", async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  await postJson(server.baseUrl, "/auth/register", {
    email: "user@example.com",
    password: "Password123",
  });
  const response = await postJson(server.baseUrl, "/auth/login", {
    email: "USER@example.com",
    password: "Password123",
  });
  const body = (await response.json()) as {
    accessToken: string;
    user: { id: string; email: string };
  };
  const { payload } = await jwtVerify(
    body.accessToken,
    new TextEncoder().encode(TEST_SECRET),
  );

  assert.equal(response.status, 200);
  assert.equal(payload.sub, body.user.id);
  assert.deepEqual(body.user, {
    id: "test-user-1",
    email: "user@example.com",
  });
});

test("login rejects an incorrect password", async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  await postJson(server.baseUrl, "/auth/register", {
    email: "user@example.com",
    password: "Password123",
  });
  const response = await postJson(server.baseUrl, "/auth/login", {
    email: "user@example.com",
    password: "WrongPass123",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { message: "Invalid email or password." },
  });
});

test("JWT middleware accepts valid tokens and rejects invalid or expired tokens", async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const validToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("authenticated-user")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(TEST_SECRET));
  const validResponse = await fetch(`${server.baseUrl}/protected`, {
    headers: { authorization: `Bearer ${validToken}` },
  });
  assert.equal(validResponse.status, 200);
  assert.deepEqual(await validResponse.json(), {
    userId: "authenticated-user",
  });

  const invalidResponse = await fetch(`${server.baseUrl}/protected`, {
    headers: { authorization: "Bearer not-a-valid-token" },
  });
  assert.equal(invalidResponse.status, 401);

  const expiredToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("authenticated-user")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
    .sign(new TextEncoder().encode(TEST_SECRET));
  const expiredResponse = await fetch(`${server.baseUrl}/protected`, {
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(expiredResponse.status, 401);
});
