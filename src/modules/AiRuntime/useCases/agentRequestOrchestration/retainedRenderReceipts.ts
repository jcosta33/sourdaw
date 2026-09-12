import { type AgentRenderReceipt } from '#/utils/agentRenderReceipt';

export type RenderedReceipt = Extract<AgentRenderReceipt, { phase: 'rendered' }>;

// Module-private so retention shares exactly the exact-lease admission `recordOwnedRenderReceipt`
// already performs: nothing outside this file can retain a receipt on its own terms.
const retainedReceiptsByRun = new Map<string, Map<string, RenderedReceipt>>();

function retainRenderedReceipt(runId: string, receipt: AgentRenderReceipt): void {
    if (receipt.phase === 'started' || receipt.phase === 'batch-settled') {
        return;
    }
    const jobId = receipt.provenance.jobId;
    if (receipt.phase !== 'rendered') {
        retainedReceiptsByRun.get(runId)?.delete(jobId);
        return;
    }
    const runReceipts = retainedReceiptsByRun.get(runId) ?? new Map<string, RenderedReceipt>();
    runReceipts.set(jobId, receipt);
    retainedReceiptsByRun.set(runId, runReceipts);
}

function getRetainedRenderedReceipts(runId: string): readonly RenderedReceipt[] {
    return Array.from(retainedReceiptsByRun.get(runId)?.values() ?? []);
}

function releaseRetainedRenderedReceipt(runId: string, jobId: string): void {
    const runReceipts = retainedReceiptsByRun.get(runId);
    if (!runReceipts) {
        return;
    }
    runReceipts.delete(jobId);
    if (runReceipts.size === 0) {
        retainedReceiptsByRun.delete(runId);
    }
}

function releaseRetainedRunReceipts(runId: string): void {
    retainedReceiptsByRun.delete(runId);
}

/**
 * Retains one job's most recent rendered receipt per run, so a later mutation can look up what
 * this run actually rendered. A `rendered` receipt supersedes the job's prior entry; a `failed` or
 * `cancelled` receipt for the job removes it, since neither describes audio a mutation may admit.
 * Retention lasts exactly as long as the rendered audio a receipt describes: releasing one job, or
 * the whole run once it settles, drops evidence no mutation can act on any more.
 */
export const retainedRenderReceipts = {
    retain: retainRenderedReceipt,
    getRetained: getRetainedRenderedReceipts,
    release: releaseRetainedRenderedReceipt,
    releaseRun: releaseRetainedRunReceipts,
};
