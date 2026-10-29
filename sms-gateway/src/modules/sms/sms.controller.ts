
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { sendWithFailover } from "../../service/failover.service.js";

const SMS_COST_PER_PART = 1;

// Basic SMS length calculation for standard GSM-style text.
// A production implementation should also account for Unicode
// and GSM extension characters.
const calculateParts = (content: string): number => {
  if (content.length <= 160) return 1;
  return Math.ceil(content.length / 153);
};

export const sendMessage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
   const userId: string | undefined = res.locals.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { to, content } = req.body ?? {};

    if (typeof to !== "string" || !/^\+[1-9]\d{7,14}$/.test(to)) {
      res.status(400).json({
        success: false,
        message: "Provide a valid international phone number, e.g. +9779812345678",
      });
      return;
    }

    if (typeof content !== "string" || !content.trim()) {
      res.status(400).json({
        success: false,
        message: "Message content is required",
      });
      return;
    }

    if (content.length > 5000) {
      res.status(400).json({
        success: false,
        message: "Message content cannot exceed 5000 characters",
      });
      return;
    }

    const parts = calculateParts(content);
    const cost = parts * SMS_COST_PER_PART;

    // Create only the message here. Do not deduct wallet credits here.
    const message = await prisma.message.create({
      data: {
        userId,
        to,
        content: content.trim(),
        parts,
        cost,
        status: "PENDING",
      },
    });

    const result = await sendWithFailover(message.id);

    if (result.status === "REJECTED") {
      res.status(402).json({
        success: false,
        message: result.reason,
        messageId: message.id,
        status: "PENDING",
      });
      return;
    }

    if (result.status === "FAILED") {
      res.status(502).json({
        success: false,
        message: result.reason,
        messageId: message.id,
        status: "FAILED",
      });
      return;
    }

    if (result.status === "SKIPPED") {
      res.status(409).json({
        success: false,
        message: "Message was already claimed or processed",
        messageId: message.id,
        status: result.currentStatus,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "SMS sent successfully",
      data: {
        messageId: result.messageId,
        to,
        parts,
        cost,
        status: result.status,
        provider: result.providerName,
      },
    });
  } catch (error) {
    console.error("Failed to send SMS:", error);

    res.status(500).json({
      success: false,
      message: "An unexpected error occurred while processing the SMS",
    });
  }
};
