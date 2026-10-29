
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import {
  InsufficientCreditsError,
  sendBatchWithFailover,
} from "../../service/failover.service.js";

const SMS_COST_PER_PART = 1;
const MAX_RECIPIENTS = 100;
const MAX_MESSAGE_LENGTH = 5000;

const calculateParts = (content: string): number => {
  if (content.length <= 160) {
    return 1;
  }

  return Math.ceil(content.length / 153);
};

const isValidPhoneNumber = (phone: string): boolean => {
  return /^\+[1-9]\d{7,14}$/.test(phone);
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

    const { to, message } = req.body ?? {};

    // Validate recipients.
    if (!Array.isArray(to) || to.length === 0) {
      res.status(400).json({
        success: false,
        message: "'to' must be a non-empty array of phone numbers",
      });
      return;
    }

    if (to.length > MAX_RECIPIENTS) {
      res.status(400).json({
        success: false,
        message: `A maximum of ${MAX_RECIPIENTS} recipients is allowed per request`,
      });
      return;
    }

    if (
      !to.every(
        (phone: unknown): phone is string => typeof phone === "string",
      )
    ) {
      res.status(400).json({
        success: false,
        message: "Every recipient must be a phone number string",
      });
      return;
    }

    // Normalize surrounding whitespace and validate phone numbers.
    const recipients: string[] = to.map((phone: string) => phone.trim());

    const invalidNumbers = recipients.filter(
      (phone: string) => !isValidPhoneNumber(phone),
    );

    if (invalidNumbers.length > 0) {
      res.status(400).json({
        success: false,
        message: "One or more phone numbers are invalid. Use international format, e.g. +9779812345678",
        invalidNumbers,
      });
      return;
    }

    // Avoid sending duplicate messages to the same recipient.
    if (new Set(recipients).size !== recipients.length) {
      res.status(400).json({
        success: false,
        message: "Duplicate phone numbers are not allowed",
      });
      return;
    }

    // Validate message content.
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({
        success: false,
        message: "'message' must be a non-empty string",
      });
      return;
    }

    const content = message.trim();

    if (content.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({
        success: false,
        message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      });
      return;
    }

    // Calculate SMS parts and cost per recipient.
    const parts = calculateParts(content);
    const cost = parts * SMS_COST_PER_PART;

    const preparedMessages = recipients.map((phone: string) => ({
      to: phone,
      content,
      parts,
      cost,
    }));

    // Reserve credits and create messages through the batch service.
    const results = await sendBatchWithFailover(userId, preparedMessages);

    const sentCount = results.filter(
      (result) => result.status === "SENT",
    ).length;

    const failedCount = results.filter(
      (result) => result.status === "FAILED",
    ).length;

    const responseStatus =
      sentCount === results.length
        ? 200
        : sentCount > 0
          ? 207
          : 502;

    res.status(responseStatus).json({
      success: failedCount === 0,
      message:
        failedCount === 0
          ? "All messages sent successfully"
          : sentCount > 0
            ? "Some messages were sent and some failed. Credits for failed messages were refunded."
            : "All messages failed. Credits for failed messages were refunded.",
      summary: {
        totalRecipients: recipients.length,
        sent: sentCount,
        failed: failedCount,
        partsPerMessage: parts,
        costPerMessage: cost,
        totalReservedCredits: cost * recipients.length,
      },
      results,
    });
  } catch (error: unknown) {
    if (error instanceof InsufficientCreditsError) {
      res.status(402).json({
        success: false,
        message: "Insufficient credits to send messages to all recipients",
      });
      return;
    }

    console.error("Failed to send SMS:", error);

    res.status(500).json({
      success: false,
      message: "An unexpected error occurred while processing the SMS request",
    });
  }
};

// List the authenticated user's messages.
export const getMessages = async (
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

    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "10"), 10) || 10),
    );

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.message.count({ where: { userId } }),
    ]);

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Failed to fetch SMS messages:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch SMS messages",
    });
  }
};

// Get one message belonging to the authenticated user.
export const getMessageById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId: string | undefined = res.locals.userId;
    const messageId = req.params.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    if (typeof messageId !== "string" || !messageId.trim()) {
      res.status(400).json({
        success: false,
        message: "A valid message ID is required",
      });
      return;
    }

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        userId,
      },
      include: {
        attempts: {
          orderBy: { createdAt: "asc" },
          include: {
            provider: {
              select: { name: true, priority: true },
            },
          },
        },
      },
    });

    if (!message) {
      res.status(404).json({
        success: false,
        message: "Message not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error: unknown) {
    console.error("Failed to fetch SMS message:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch SMS message",
    });
  }
};
