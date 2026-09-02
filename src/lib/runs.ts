import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { append } from "./ledger";
import { disarm, type ChaosMode } from "./razorpay/chaos";

/**
 * Agent runs.
 *
 * A run groups everything one execution of the buyer agent did — its purchases, its
 * refusals, and the ledger events for both. The gateway can also be called with no run
 * at all (the evaluation suite does exactly that), so `runId` is always optional
 * downstream.
 */

export type RunStatus = "RUNNING" | "COMPLETED" | "HALTED_REVOKED" | "FAILED";

export async function startRun(params: {
  mandateId: string;
  goal: string;
  chaos?: ChaosMode | null;
}): Promise<string> {
  const id = `run_${randomBytes(6).toString("hex")}`;

  await prisma.agentRun.create({
    data: {
      id,
      mandateId: params.mandateId,
      goal: params.goal,
      status: "RUNNING",
      chaos: params.chaos ?? null,
    },
  });

  await append({
    actor: "system",
    type: "AGENT_RUN_STARTED",
    mandateId: params.mandateId,
    runId: id,
    payload: { goal: params.goal, chaos: params.chaos ?? null },
  });

  return id;
}

export async function endRun(params: {
  runId: string;
  mandateId: string;
  status: RunStatus;
  summary?: Record<string, unknown>;
}): Promise<void> {
  await prisma.agentRun.update({
    where: { id: params.runId },
    data: { status: params.status, endedAt: new Date() },
  });

  // A run that ends with chaos still armed would leak the injection into the next run.
  disarm(params.runId);

  await append({
    actor: "system",
    type: "AGENT_RUN_ENDED",
    mandateId: params.mandateId,
    runId: params.runId,
    payload: { status: params.status, ...(params.summary ?? {}) },
  });
}
