
import { prisma } from "../lib/prisma.js";

type SendSmsResult =
  | { success: true; providerId: string }
  | { success: false; providerId: string; reason: string };

export const getBalance = async (providerId: string): Promise<number> => {
  const provider = await prisma.smsProvider.findUnique({
    where: { id: providerId },
    select: { balance: true },
  });

  if (!provider) {
    throw new Error("SMS provider not found");
  }

  return provider.balance;
};

export const sendSms = async (
  providerId: string,
  to: string,
  content: string,
  cost: number,
): Promise<SendSmsResult> => {
  const provider = await prisma.smsProvider.findUnique({
    where: { id: providerId },
  });

  if (!provider || !provider.isActive) {
    return {
      success: false,
      providerId,
      reason: "Provider not found or inactive",
    };
  }

  if (!to.trim() || !content.trim() || !Number.isInteger(cost) || cost <= 0) {
    return {
      success: false,
      providerId,
      reason: "Invalid SMS details or cost",
    };
  }

  if (provider.balance < cost) {
    return {
      success: false,
      providerId,
      reason: "Insufficient provider balance",
    };
  }

  // Simulate the provider's configured failure rate.
  if (Math.random() < provider.failureRate) {
    return {
      success: false,
      providerId,
      reason: "Mock provider delivery failure",
    };
  }

  // Deduct provider funds atomically to prevent negative balances.
  const deduction = await prisma.smsProvider.updateMany({
    where: {
      id: providerId,
      isActive: true,
      balance: { gte: cost },
    },
    data: {
      balance: { decrement: cost },
    },
  });

  if (deduction.count === 0) {
    return {
      success: false,
      providerId,
      reason: "Provider became inactive or has insufficient balance",
    };
  }

  return { success: true, providerId };
};
