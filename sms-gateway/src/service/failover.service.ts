
import { prisma } from "../lib/prisma.js";
import { sendSms } from "./mock-provider.service.js";

class InsufficientCreditsError extends Error {}

type FailoverResult =
  | {
      status: "SENT";
      messageId: string;
      providerId: string;
      providerName: string;
    }
  | {
      status: "FAILED";
      messageId: string;
      reason: string;
    }
  | {
      status: "REJECTED";
      messageId: string;
      reason: string;
    }
  | {
      status: "SKIPPED";
      messageId: string;
      currentStatus: string;
    };

export const sendWithFailover = async (
  messageId: string,
): Promise<FailoverResult> => {
  // 1. Atomically claim the message and charge the wallet.
  let reservation;

  try {
    reservation = await prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        throw new Error("Message not found");
      }

      if (!Number.isInteger(message.cost) || message.cost <= 0) {
        throw new Error("Message cost must be a positive integer");
      }

      // Only one request can change PENDING to PROCESSING.
      const claim = await tx.message.updateMany({
        where: {
          id: messageId,
          status: "PENDING",
        },
        data: {
          status: "PROCESSING",
        },
      });

      if (claim.count === 0) {
        const current = await tx.message.findUnique({
          where: { id: messageId },
          select: { status: true },
        });

        if (!current) {
          throw new Error("Message not found");
        }

        return {
          claimed: false as const,
          status: current.status,
        };
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId: message.userId },
      });

      if (!wallet || wallet.balance < message.cost) {
        throw new InsufficientCreditsError(
          "Insufficient wallet credits",
        );
      }

      // Conditional update prevents concurrent overspending.
      const debit = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          balance: { gte: message.cost },
        },
        data: {
          balance: { decrement: message.cost },
        },
      });

      if (debit.count !== 1) {
        throw new InsufficientCreditsError(
          "Insufficient wallet credits",
        );
      }

      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          messageId: message.id,
          amount: message.cost,
          type: "DEDUCTION",
        },
      });

      return {
        claimed: true as const,
        message,
      };
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return {
        status: "REJECTED",
        messageId,
        reason: error.message,
      };
    }

    throw error;
  }

  // A different request already claimed or completed this message.
  if (!reservation.claimed) {
    return {
      status: "SKIPPED",
      messageId,
      currentStatus: reservation.status,
    };
  }

  const message = reservation.message;

  // 2. Load active providers in priority order.
  const providers = await prisma.smsProvider.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });

  // 3. Attempt delivery through each provider.
  for (const provider of providers) {
    const attempt = await prisma.messageAttempt.create({
      data: {
        messageId,
        providerId: provider.id,
        status: "PENDING",
      },
    });

    // Let unexpected database errors propagate instead of
    // incorrectly treating them as ordinary provider failures.
    const result = await sendSms(
      provider.id,
      message.to,
      message.content,
      message.cost,
    );

    if (!result.success) {
      await prisma.messageAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          errorMessage: result.reason,
        },
      });

      continue;
    }

    // Finalize the attempt and message together.
    await prisma.$transaction(async (tx) => {
      const finalized = await tx.message.updateMany({
        where: {
          id: messageId,
          status: "PROCESSING",
        },
        data: { status: "SENT" },
      });

      if (finalized.count !== 1) {
        throw new Error(
          "Could not finalize message; manual reconciliation required",
        );
      }

      await tx.messageAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "SENT",
          errorMessage: null,
        },
      });
    });

    return {
      status: "SENT",
      messageId,
      providerId: provider.id,
      providerName: provider.name,
    };
  }

  // 4. All providers failed. Refund exactly once.
  const refunded = await prisma.$transaction(async (tx) => {
    // This conditional transition is the refund's idempotency guard.
    const finalized = await tx.message.updateMany({
      where: {
        id: messageId,
        status: "PROCESSING",
      },
      data: { status: "FAILED" },
    });

    if (finalized.count !== 1) {
      return false;
    }

    const wallet = await tx.wallet.findUnique({
      where: { userId: message.userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found during refund");
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: message.cost },
      },
    });

    await tx.creditTransaction.create({
      data: {
        walletId: wallet.id,
        messageId,
        amount: message.cost,
        type: "REFUND",
      },
    });

    return true;
  });

  if (!refunded) {
    return {
      status: "SKIPPED",
      messageId,
      currentStatus: "No refund performed; message state changed",
    };
  }

  return {
    status: "FAILED",
    messageId,
    reason:
      providers.length === 0
        ? "No active providers available; credits refunded"
        : "All providers failed; credits refunded",
  };
};
