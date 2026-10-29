
import { prisma } from "../src/lib/prisma.js";

const providers = [
  {
    name: "RouteA",
    priority: 1,
    balance: 1000,
    failureRate: 0.1,
    isActive: true,
  },
  {
    name: "RouteB",
    priority: 2,
    balance: 1000,
    failureRate: 0.2,
    isActive: true,
  },
  {
    name: "RouteC",
    priority: 3,
    balance: 1000,
    failureRate: 0.05,
    isActive: true,
  },
];



const seedProviders = async () => {
  for (const provider of providers) {
    await prisma.smsProvider.upsert({
      where: { name: provider.name },
      update: {
        priority: provider.priority,
        failureRate: provider.failureRate,
        isActive: provider.isActive,
      },
      create: provider,
    });
  }

  console.log("Mock SMS providers seeded successfully");
};

seedProviders()
  .catch((error) => {
    console.error("Failed to seed providers:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });