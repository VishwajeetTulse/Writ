-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT 'demo-user',
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

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mandateId" TEXT NOT NULL,
    "runId" TEXT,
    "merchantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paymentLinkUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mandateId" TEXT,
    "runId" TEXT,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verdict" TEXT,
    "reasonCode" TEXT,
    "amountPaise" BIGINT,
    "latencyUs" INTEGER,
    "payload" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mandateId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "chaos" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "AgentRun_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vpa" TEXT NOT NULL,
    "category" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "sku" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pricePaise" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Mandate_status_idx" ON "Mandate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_idempotencyKey_key" ON "Purchase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Purchase_mandateId_idx" ON "Purchase"("mandateId");

-- CreateIndex
CREATE INDEX "Purchase_razorpayOrderId_idx" ON "Purchase"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "AuditEvent_mandateId_idx" ON "AuditEvent"("mandateId");

-- CreateIndex
CREATE INDEX "AuditEvent_runId_idx" ON "AuditEvent"("runId");

-- CreateIndex
CREATE INDEX "AuditEvent_verdict_idx" ON "AuditEvent"("verdict");

-- CreateIndex
CREATE INDEX "Product_merchantId_idx" ON "Product"("merchantId");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");
