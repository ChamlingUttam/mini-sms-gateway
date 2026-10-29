
import { prisma } from "../lib/prisma.js";
import { sendSms } from "./mock-provider.service.js";

export class InsufficientCreditsError extends Error {}

type PreparedMessage = {
  to: string;
  content: string;
  parts: number;
  cost: number;
};

type DeliveryResult = {
  messageId: string;
  to: string;
  cost: number;
  status: "SENT" | "FAILED" | "SKIPPED";
  provider?: string;
  reason?: string;
};

export const sendBatchWithFailover = async (
  userId: string,
  messages: PreparedMessage[],
): Promise<DeliveryResult[]> => {
  const totalCost = messages.reduce((sum, message) => sum + message.cost, 0);

  // Reserve the full batch cost and create its records atomically.
  const reservedMessages = await prisma.$transaction(async (tx) => {
    const debit = await tx.wallet.updateMany({
      where: {
        userId,
        balance: { gte: totalCost },
      },
      data: {
        balance: { decrement: totalCost },
      },
    });

    if (debit.count !== 1) {
      throw new InsufficientCreditsError("Insufficient wallet credits");
    }

    const created = [];

    for (const item of messages) {
      const message = await tx.message.create({
        data: {
          userId,
          to: item.to,
          content: item.content,
          parts: item.parts,
          cost: item.cost,
          status: "PENDING",
        },
      });

      await tx.creditTransaction.create({
        data: {
          walletId: (
            await tx.wallet.findUniqueOrThrow({
              where: { userId },
              select: { id: true },
            })
          ).id,
          messageId: message.id,
          amount: item.cost,
          type: "DEDUCTION",
        },
      });

      created.push(message);
    }

    return created;
  });

  // Deliver each already-paid message. Do not debit the wallet again.
  const results: DeliveryResult[] = [];

  for (const message of reservedMessages) {
    const claim = await prisma.message.updateMany({
      where: { id: message.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });

    if (claim.count !== 1) {
      results.push({
        messageId: message.id,
        to: message.to,
        cost: message.cost,
        status: "SKIPPED",
        reason: "Message was already claimed",
      });
      continue;
    }

    const providers = await prisma.smsProvider.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
    });

    let deliveredBy: string | undefined;

    for (const provider of providers) {
      const attempt = await prisma.messageAttempt.create({
        data: {
          messageId: message.id,
          providerId: provider.id,
          status: "PENDING",
        },
      });

      const delivery = await sendSms(
        provider.id,
        message.to,
        message.content,
        message.cost,
      );

      if (!delivery.success) {
        await prisma.messageAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "FAILED",
            errorMessage: delivery.reason,
          },
        });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const finalized = await tx.message.updateMany({
          where: { id: message.id, status: "PROCESSING" },
          data: { status: "SENT" },
        });

        if (finalized.count !== 1) {
          throw new Error("Could not finalize message");
        }

        await tx.messageAttempt.update({
          where: { id: attempt.id },
          data: { status: "SENT", errorMessage: null },
        });
      });

      deliveredBy = provider.name;
      break;
    }

    if (deliveredBy) {
      results.push({
        messageId: message.id,
        to: message.to,
        cost: message.cost,
        status: "SENT",
        provider: deliveredBy,
      });
      continue;
    }

    // Every provider failed. Refund this message exactly once.
    await prisma.$transaction(async (tx) => {
      const finalized = await tx.message.updateMany({
        where: { id: message.id, status: "PROCESSING" },
        data: { status: "FAILED" },
      });

      if (finalized.count !== 1) {
        throw new Error("Could not finalize failed message for refund");
      }

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: message.cost } },
      });

      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          messageId: message.id,
          amount: message.cost,
          type: "REFUND",
        },
      });
    });

    results.push({
      messageId: message.id,
      to: message.to,
      cost: message.cost,
      status: "FAILED",
      reason: "All providers failed; credits refunded",
    });
  }

  return results;
};
