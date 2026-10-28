import cors from "cors";
import express from "express";
import authRouter from "./modules/auth/auth.routes.js";
import { errorHandler } from "./middlewares/error-handler.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use((_req, res) => {
  res.status(404).json({
    error: {
      message: "Not Found",
    },
  });
});

app.use(errorHandler);

export default app;
