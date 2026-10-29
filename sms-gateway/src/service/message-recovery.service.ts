
import { prisma } from "../lib/prisma.js";

const RECOVERY_INTERVAL_MS = 60_000; // Check every minute
const STUCK_AFTER_MS = 10 * 60_000; // 10 minutes

/**
 * Refunds messages that have remained PROCESSING for too long.
 */
export const recoverStuckMessages = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);

  const stuckMessages = await prisma.message.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      userId: true,
      cost: true,
    },
  });

  let recoveredCount = 0;

  for (const message of stuckMessages) {
    try {
      const recovered = await prisma.$transaction(async (tx) => {
        // Only recover if the message is still stale and PROCESSING.
        const claimed = await tx.message.updateMany({
          where: {
            id: message.id,
            status: "PROCESSING",
            updatedAt: { lt: cutoff },
          },
          data: {
            status: "FAILED",
          },
        });

        // Another process already handled this message.
        if (claimed.count === 0) {
          return false;
        }

        const wallet = await tx.wallet.findUnique({
          where: { userId: message.userId },
          select: { id: true },
        });

        if (!wallet) {
          throw new Error(
            `Wallet not found for message ${message.id}`,
          );
        }

        // Refund the reserved credits.
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: message.cost },
          },
        });

        // Keep an auditable refund record.
        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            messageId: message.id,
            amount: message.cost,
            type: "REFUND",
          },
        });

        return true;
      });

      if (recovered) {
        recoveredCount++;
        console.info(
          `Recovered stuck SMS message ${message.id}; refunded ${message.cost} credit(s).`,
        );
      }
    } catch (error: unknown) {
      console.error(
        `Failed to recover SMS message ${message.id}:`,
        error,
      );
    }
  }

  return recoveredCount;
};

/**
 * Starts a background worker that periodically recovers stuck messages.
 */
export const startMessageRecoveryWorker = (): void => {
  let isRunning = false;

  const runRecovery = async (): Promise<void> => {
    if (isRunning) return;

    isRunning = true;

    try {
      const recoveredCount = await recoverStuckMessages();

      if (recoveredCount > 0) {
        console.info(
          `SMS recovery completed: ${recoveredCount} message(s) recovered.`,
        );
      }
    } catch (error: unknown) {
      console.error("SMS recovery worker failed:", error);
    } finally {
      isRunning = false;
    }
  };

  // Recover existing stuck messages after startup.
  void runRecovery();

  // Continue checking periodically.
  const timer = setInterval(() => {
    void runRecovery();
  }, RECOVERY_INTERVAL_MS);

  // Do not keep the Node.js process alive solely for this timer.
  timer.unref();
};
