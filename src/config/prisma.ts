import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 connects through a driver adapter instead of a built-in engine.
const adapter = new PrismaPg(process.env.DATABASE_URL!);

export const prisma = new PrismaClient({ adapter });
