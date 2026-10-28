import type { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        message: error.message,
      },
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    res.status(400).json({
      error: {
        message: "Invalid JSON request body.",
      },
    });
    return;
  }

  console.error("Unhandled request error.");
  res.status(500).json({
    error: {
      message: "Internal Server Error",
    },
  });
};
