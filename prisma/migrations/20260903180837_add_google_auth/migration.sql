-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    PRIMARY KEY ("provider", "providerAccountId"),
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,

    PRIMARY KEY ("identifier", "token")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Mandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "intentText" TEXT NOT NULL,
    "merchants" TEXT NOT NULL,
    "categories" TEXT NOT NULL,
    "perTxnCapPaise" BIGINT NOT NULL,
    "totalCapPaise" BIGINT NOT NULL,
    "velocityMax" INTEGER,
    "velocityWindowS" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signature" TEXT NOT NULL DEFAULT '',
    "signedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Mandate" ("categories", "createdAt", "expiresAt", "id", "intentText", "merchants", "perTxnCapPaise", "revokedAt", "signature", "signedAt", "status", "totalCapPaise", "userId", "velocityMax", "velocityWindowS") SELECT "categories", "createdAt", "expiresAt", "id", "intentText", "merchants", "perTxnCapPaise", "revokedAt", "signature", "signedAt", "status", "totalCapPaise", "userId", "velocityMax", "velocityWindowS" FROM "Mandate";
DROP TABLE "Mandate";
ALTER TABLE "new_Mandate" RENAME TO "Mandate";
CREATE INDEX "Mandate_status_idx" ON "Mandate"("status");
CREATE INDEX "Mandate_userId_idx" ON "Mandate"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
