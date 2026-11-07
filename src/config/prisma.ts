/**
 * Prisma client singleton.
 *
 * Module-level instance, so every importer shares one client and its connection
 * pool rather than opening a new pool per use.
 */
import "dotenv/config";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = pkg;

// Prisma 7 connects through a driver adapter instead of a built-in engine.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

/** Shared Prisma client. Disconnected during graceful shutdown in `server.ts`. */
export const prisma = new PrismaClient({ adapter });
