
import jwt, { type JwtPayload } from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  return secret;
}

export function generateAccessToken(userId: string): string {
  return jwt.sign({}, getJwtSecret(), {
    subject: userId,
    expiresIn: "1h",
  });
}

export function verifyAccessToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, getJwtSecret());

    if (
      typeof payload === "string" ||
      typeof (payload as JwtPayload).sub !== "string"
    ) {
      return null;
    }

    return (payload as JwtPayload).sub!;
  } catch {
    return null;
  }
}
