import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';
import { type AgentRenderReceipt, type AgentWorkOwnerIdentity } from '#/utils/agentRenderReceipt';
import { type AppAction } from '#/utils/handlerContract';

export type AgentRenderReceiptMutation =
    | { type: 'bounceSelection' | 'consolidateSelection'; trackId: string; startBeat: number; endBeat: number }
    | { type: 'freezeTrack' | 'bounceInPlace' | 'bounceToNewTrack' | 'flattenTrack'; trackId: string };

export type AgentRenderReceiptRejectionReason =
    | 'receipt-not-rendered'
    | 'lease-mismatch'
    | 'stale-revision'
    | 'artifact-missing'
    | 'content-address-mismatch'
    | 'range-mismatch';

export type AgentRenderReceiptAdmission =
    { status: 'admitted'; action: AppAction } | { status: 'rejected'; reason: AgentRenderReceiptRejectionReason };

// AudioRendering's own render pipeline (`renderToClip`) imports Arrangement's use cases, so this
// Arrangement-owned adapter cannot import AudioRendering's barrel without a module cycle. The caller
// (AiRuntime) reads `getAgentSectionRenderArtifacts()` and passes the retained artifacts in; this
// shape is the exact subset the admission decision reads, kept local for that reason.
export type AgentRenderArtifactSnapshot = {
    jobId: string;
    sectionId: string;
    sectionName: string;
    startBeat: number;
    endBeat: number;
    sampleRate: number;
    tailSeconds: number;
    sourceRevision: string;
    contentAddress: string;
    frameCount: number;
    channelCount: number;
};

type RenderedReceipt = Extract<AgentRenderReceipt, { phase: 'rendered' }>;

function isRangeMutation(
    mutation: AgentRenderReceiptMutation
): mutation is Extract<AgentRenderReceiptMutation, { type: 'bounceSelection' | 'consolidateSelection' }> {
    return mutation.type === 'bounceSelection' || mutation.type === 'consolidateSelection';
}

// The render ran under its own work lease, so `workId` and `leaseId` legitimately differ from the
// mutation's lease; the binding this checks is run identity plus cancellation generation.
function isLeaseMismatch(
    receiptOwner: AgentWorkOwnerIdentity | null,
    liveOwner: AgentWorkOwnerIdentity | null
): boolean {
    return (
        !liveOwner ||
        !receiptOwner ||
        receiptOwner.runId !== liveOwner.runId ||
        receiptOwner.cancellationGeneration !== liveOwner.cancellationGeneration
    );
}

function artifactMatchesReceipt(artifact: AgentRenderArtifactSnapshot, receipt: RenderedReceipt): boolean {
    const provenanceMatches =
        artifact.jobId === receipt.provenance.jobId &&
        artifact.sectionId === receipt.provenance.sectionId &&
        artifact.sectionName === receipt.provenance.sectionName &&
        artifact.startBeat === receipt.provenance.startBeat &&
        artifact.endBeat === receipt.provenance.endBeat &&
        artifact.sampleRate === receipt.provenance.sampleRate &&
        artifact.tailSeconds === receipt.provenance.tailSeconds &&
        artifact.sourceRevision === receipt.provenance.sourceRevision;
    return (
        provenanceMatches &&
        artifact.contentAddress === receipt.contentAddress &&
        artifact.frameCount === receipt.frameCount &&
        artifact.channelCount === receipt.channelCount
    );
}

/**
 * Admits a rendered agent section receipt in front of exactly one ordinary range mutation, or
 * rejects it. Every check reads live project and render state; nothing here mutates.
 */
export function admitAgentRenderReceipt(input: {
    receipt: AgentRenderReceipt;
    liveOwner: AgentWorkOwnerIdentity | null;
    mutation: AgentRenderReceiptMutation;
    artifacts: readonly AgentRenderArtifactSnapshot[];
}): AgentRenderReceiptAdmission {
    const { receipt, liveOwner, mutation, artifacts } = input;
    if (receipt.phase !== 'rendered') {
        return { status: 'rejected', reason: 'receipt-not-rendered' };
    }
    if (isLeaseMismatch(receipt.owner, liveOwner)) {
        return { status: 'rejected', reason: 'lease-mismatch' };
    }
    if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(receipt.provenance.sourceRevision)) {
        return { status: 'rejected', reason: 'stale-revision' };
    }
    const artifact = artifacts.find((candidate) => candidate.jobId === receipt.provenance.jobId);
    if (!artifact) {
        return { status: 'rejected', reason: 'artifact-missing' };
    }
    if (!artifactMatchesReceipt(artifact, receipt)) {
        return { status: 'rejected', reason: 'content-address-mismatch' };
    }
    if (isRangeMutation(mutation)) {
        if (mutation.startBeat !== receipt.provenance.startBeat || mutation.endBeat !== receipt.provenance.endBeat) {
            return { status: 'rejected', reason: 'range-mismatch' };
        }
        return {
            status: 'admitted',
            action: {
                type: mutation.type,
                payload: { trackId: mutation.trackId, startBeat: mutation.startBeat, endBeat: mutation.endBeat },
            },
        };
    }
    return { status: 'admitted', action: { type: mutation.type, payload: { trackId: mutation.trackId } } };
}
