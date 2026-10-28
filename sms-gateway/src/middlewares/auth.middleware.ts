
import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../config/generateToken.js";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({
      message: "Authentication token is required",
    });
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();
  const userId = verifyAccessToken(token);

  if (!userId) {
    res.status(401).json({
      message: "Invalid or expired authentication token",
    });
    return;
  }

  res.locals.userId = userId;
  next();
}
