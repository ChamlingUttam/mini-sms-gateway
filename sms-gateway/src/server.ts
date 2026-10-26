// import "dotenv/config";
// import app from "./app.js";
// import { env } from "./config/env.js";

// async function logDatabaseStatus(): Promise<void> {
//   const connectionString = process.env.DATABASE_URL;

//   try {
//     const { prisma } = await import("./lib/prisma.js");
//     await prisma.$connect();
//     console.log("Database connection successful.");
//   } catch (error) {
//     const message =
//       error instanceof Error ? error.message : "An unknown error occurred.";
//     const safeMessage = connectionString
//       ? message.replaceAll(connectionString, "[redacted]")
//       : message;

//     console.error(`Database connection failed: ${safeMessage}`);
//   }
// }

// app.listen(env.port, () => {
//   console.log(`SMS Gateway API listening on port ${env.port}`);
//   void logDatabaseStatus();
// });


















import app from './app.js';
import config from './config/config.js';
import { prisma } from './lib/prisma.js';

async function startServer() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connected.');

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
    });
  } catch {
    console.error(
      'Database connection failed. Check DATABASE_URL and confirm the Neon database is reachable.',
    );
    process.exitCode = 1;
  }
}

void startServer();