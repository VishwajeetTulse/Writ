import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { installBigIntJson } from "./money";

/**
 * Prisma client singleton.
 *
 * Prisma 7 requires an explicit driver adapter — the client no longer carries a bundled
 * query engine that reads `datasource.url` on its own. For SQLite that means constructing
 * `PrismaBetterSqlite3` with the connection string ourselves.
 *
 * Next's dev server hot-reloads modules, which would otherwise open a new connection on
 * every edit. Caching on `globalThis` keeps one client across reloads; in production the
 * module is evaluated once anyway.
 */

installBigIntJson();

export function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
