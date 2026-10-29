
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";

export const getMessages = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId: string | undefined = res.locals.userId;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return;
  }

  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 10);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    res.status(400).json({
      success: false,
      message: "Page must be positive and limit must be between 1 and 50",
    });
    return;
  }

  const [messages, total] = await prisma.$transaction([
    prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        to: true,
        content: true,
        parts: true,
        cost: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.message.count({
      where: { userId },
    }),
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
};

export const getMessageById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId: string | undefined = res.locals.userId;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return;
  }

  

 const messageId = req.params.id;

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
    select: {
      id: true,
      to: true,
      content: true,
      parts: true,
      cost: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      attempts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          provider: {
            select: {
              name: true,
              priority: true,
            },
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
};
