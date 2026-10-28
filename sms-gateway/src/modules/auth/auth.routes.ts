import { Router } from "express";
import { register, login, me } from "./auth.controller.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);

export default authRouter;