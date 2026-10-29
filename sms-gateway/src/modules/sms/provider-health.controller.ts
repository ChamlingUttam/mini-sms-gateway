
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";

const TARGET_BALANCE = 1000;
const RELIABILITY_WEIGHT = 0.8;
const BALANCE_WEIGHT = 0.2;

export const getProviderHealth = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [providers, attempts] = await Promise.all([
      prisma.smsProvider.findMany({
        orderBy: [{ priority: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          priority: true,
          balance: true,
          isActive: true,
        },
      }),

      prisma.messageAttempt.groupBy({
        by: ["providerId", "status"],
        where: {
          createdAt: { gte: since },
          status: { in: ["SENT", "FAILED"] },
        },
        _count: { _all: true },
      }),
    ]);

    const data = providers.map((provider) => {
      const providerAttempts = attempts.filter(
        (attempt) => attempt.providerId === provider.id,
      );

      const successfulAttempts =
        providerAttempts.find((a) => a.status === "SENT")?._count._all ?? 0;

      const failedAttempts =
        providerAttempts.find((a) => a.status === "FAILED")?._count._all ?? 0;

      const totalAttempts = successfulAttempts + failedAttempts;

      const successRate =
        totalAttempts === 0
          ? null
          : Number(
              ((successfulAttempts / totalAttempts) * 100).toFixed(2),
            );

      const balanceScore = Math.min(
        (provider.balance / TARGET_BALANCE) * 100,
        100,
      );

      // No recent attempts: use a neutral reliability score.
      const reliabilityScore = successRate ?? 100;

      const healthPercentage = Number(
        (
          RELIABILITY_WEIGHT * reliabilityScore +
          BALANCE_WEIGHT * balanceScore
        ).toFixed(2),
      );

      return {
        id: provider.id,
        name: provider.name,
        priority: provider.priority,
        balance: provider.balance,
        isActive: provider.isActive,
        period: "last 24 hours",
        totalAttempts,
        successfulAttempts,
        failedAttempts,
        successRate,
        balanceScore: Number(balanceScore.toFixed(2)),
        healthPercentage,
        healthConfidence:
          totalAttempts === 0 ? "INSUFFICIENT_DATA" : "BASED_ON_RECENT_ATTEMPTS",
      };
    });

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Failed to retrieve provider health:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve provider health",
    });
  }
};
