
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { generateAccessToken } from"../../config/generateToken.js"

const INITIAL_CREDITS = 100;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isValidEmail = (email: string): boolean =>
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isObject(req.body)) {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !isValidEmail(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      res.status(400).json({
        message:
          "Provide a valid email and a password of at least 8 characters and at most 72 bytes.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        wallet: {
          create: { balance: INITIAL_CREDITS },
        },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        wallet: {
          select: { balance: true },
        },
      },
    });

    res.status(201).json({
      message: "Registration successful",
      user,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({
        message: "An account with this email already exists",
      });
      return;
    }

    next(error);
  }
};




//login user
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isObject(req.body)) {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !isValidEmail(email) ||
      typeof password !== "string" ||
      password.length === 0 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      res.status(400).json({
        message: "Provide a valid email and password",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    const enteredPassword = user?.password ?? ""
    const comparePasword = await bcrypt.compare(password, enteredPassword)

    if (!user || !comparePasword) {
      res.status(401).json({
        message: "Invalid email or password",
      });
      return;
    }

    const accessToken = generateAccessToken(user.id);

    res.status(200).json({
      message: "Login successful",
      accessToken,
      tokenType: "Bearer",
      expiresIn: 3600,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
};



//login user details /me
export const me = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = res.locals.userId as string;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        wallet: {
          select: { balance: true },
        },
      },
    });

    if (!user) {
      res.status(401).json({
        message: "User no longer exists",
      });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};
