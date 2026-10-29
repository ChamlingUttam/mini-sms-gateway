
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { sendMessage } from "./sms.controller.js";
import { getMessageById, getMessages } from "./sms-logs.controller.js";

const router = Router();

router.post("/send", requireAuth, sendMessage);
router.get("/messages", requireAuth, getMessages);
router.get("/messages/:id", requireAuth, getMessageById);

export default router;
