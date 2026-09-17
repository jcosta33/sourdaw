import { trackStore } from '#/modules/Arrangement/stores';
import { cacheAudioBuffer, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';
import { DEFAULT_TEMPO_BPM, transportStore } from '#/modules/Transport/stores';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { type AgentAuditionReceipt, type AgentAuditionRejectionReason } from './auditionAgentCatalogCandidate';
import { decodeCatalogCandidateFile } from './decodeCatalogCandidateFile';

/**
 * Place auditioned audio on the timeline.
 *
 * This is the only step of the workflow that writes project state, and it
 * writes it as one ordinary `addClip` command: the clip an agent places is
 * undoable, replicated and revertible by exactly the mechanism a clip the user
 * dragged in uses.
 *
 * The audio is resolved and decoded again rather than carried over from the
 * audition, and its content address must still be the audited one. A library
 * file can be replaced, re-rendered or truncated between hearing it and placing
 * it, and audio nobody auditioned must not reach the project under an audition
 * receipt's authority.
 */

const SECONDS_PER_MINUTE = 60;

type AssetTransfer = ReturnType<typeof getAssetTransfer>;
type StagedAsset = Awaited<ReturnType<NonNullable<AssetTransfer>['stageLocalAsset']>>;
type BatchResult = Awaited<ReturnType<typeof executeAppActionBatch>>;

type ApplyAgentAuditionCandidateInput = {
    readonly receipt: AgentAuditionReceipt;
    readonly trackId: string;
    readonly startBeat: number;
};

/**
 * `track-not-audio` also answers a track id that names nothing: a destination
 * the project does not hold is no more able to carry an audio clip than a bus is.
 */
type ApplyAgentAuditionRejectionReason =
    | AgentAuditionRejectionReason
    | 'track-not-audio'
    | 'content-address-mismatch'
    | 'empty-audio'
    | 'asset-staging-failed'
    | 'project-write-refused';

type ApplyAgentAuditionCandidateResult =
    | {
          readonly status: 'applied';
          readonly audioBufferId: string;
          readonly contentAddress: string;
          readonly clipName: string;
          readonly startBeat: number;
          readonly endBeat: number;
          readonly assetFinalized: boolean;
      }
    | {
          /**
           * The batch may or may not have reached the document. Its media is kept
           * and its asset promoted exactly as on the committed path, because a
           * clip that did land must not be left pointing at a discarded buffer.
           */
          readonly status: 'ambiguous';
          readonly detail: string;
          readonly audioBufferId: string;
          readonly contentAddress: string;
          readonly assetFinalized: boolean;
      }
    | {
          readonly status: 'rejected';
          readonly reason: ApplyAgentAuditionRejectionReason;
          readonly detail?: string;
      };

type VerifiedAudio =
    | { readonly status: 'verified'; readonly file: File; readonly buffer: AudioBuffer }
    | { readonly status: 'rejected'; readonly reason: ApplyAgentAuditionRejectionReason };

type AddClipPayload = {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type: 'audio';
    audioBufferId: string;
    assetHash?: string;
};

type PlacementPlan = {
    readonly buffer: AudioBuffer;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly clipName: string;
    readonly staged: StagedAsset | undefined;
    readonly assetTransfer: AssetTransfer;
};

type PlacementAttempt =
    | { readonly status: 'dispatched'; readonly audioBufferId: string; readonly batchResult: BatchResult }
    | { readonly status: 'failed'; readonly detail: string };

function isAudioTrack(trackId: string): boolean {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return track?.kind === 'audio';
}

async function verifyAuditionedAudio(receipt: AgentAuditionReceipt): Promise<VerifiedAudio> {
    const resolved = await resolveAgentCatalogCandidate({ candidateId: receipt.candidateId });
    if (resolved.status === 'rejected') {
        return { status: 'rejected', reason: resolved.reason };
    }

    const buffer = await decodeCatalogCandidateFile(resolved.file);
    if (!buffer) {
        return { status: 'rejected', reason: 'undecodable-audio' };
    }
    if (buffer.duration <= 0) {
        return { status: 'rejected', reason: 'empty-audio' };
    }

    const contentAddress = await getAudioBufferContentAddress(buffer);
    if (contentAddress !== receipt.contentAddress) {
        return { status: 'rejected', reason: 'content-address-mismatch' };
    }
    return { status: 'verified', file: resolved.file, buffer };
}

async function stageAuditionedAsset(
    assetTransfer: AssetTransfer,
    file: File
): Promise<StagedAsset | 'failed' | undefined> {
    if (!assetTransfer) {
        return undefined;
    }
    try {
        return await assetTransfer.stageLocalAsset(file, file.name);
    } catch {
        return 'failed';
    }
}

function readClipEndBeat(buffer: AudioBuffer, startBeat: number): number {
    const tempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
    return startBeat + (buffer.duration / SECONDS_PER_MINUTE) * tempo;
}

function buildAddClipPayload(plan: PlacementPlan, audioBufferId: string): AddClipPayload {
    const payload: AddClipPayload = {
        trackId: plan.trackId,
        startBeat: plan.startBeat,
        endBeat: plan.endBeat,
        name: plan.clipName,
        type: 'audio',
        audioBufferId,
    };
    if (!plan.staged) {
        return payload;
    }
    return { ...payload, assetHash: plan.staged.hash };
}

function releasePreparedMedia(plan: PlacementPlan, audioBufferId: string | undefined): void {
    if (audioBufferId !== undefined) {
        discardDecodedAudioFile(audioBufferId);
    }
    if (plan.staged) {
        plan.assetTransfer?.releaseStagedAsset(plan.staged.leaseId);
    }
}

function readThrownDetail(error: unknown): string {
    return error instanceof Error ? error.message : 'the placement batch threw a non-error value';
}

/**
 * Caching the buffer and dispatching the batch are one window because the cache
 * entry exists only to be named by the command. A throw anywhere inside leaves
 * an orphan buffer and an unreleased lease unless both are undone here.
 */
async function attemptPlacement(plan: PlacementPlan): Promise<PlacementAttempt> {
    let audioBufferId: string | undefined;
    try {
        audioBufferId = cacheAudioBuffer({ buffer: plan.buffer });
        const batchResult = await executeAppActionBatch(
            [{ type: 'addClip', payload: buildAddClipPayload(plan, audioBufferId) }],
            {
                groupId: `agent-audition-${crypto.randomUUID()}`,
                groupLabel: `Place auditioned sample: ${plan.clipName}`,
                source: 'ai',
                requireCompensation: true,
            }
        );
        return { status: 'dispatched', audioBufferId, batchResult };
    } catch (error) {
        releasePreparedMedia(plan, audioBufferId);
        return { status: 'failed', detail: readThrownDetail(error) };
    }
}

function finalizeStagedAsset(plan: PlacementPlan): boolean {
    if (!plan.staged) {
        return false;
    }
    try {
        plan.assetTransfer?.promoteStagedAsset(plan.staged.leaseId);
        return true;
    } catch {
        // The clip is committed and replicated; only the durable copy of its
        // asset is missing, which the caller reports rather than undoing a
        // write the project already accepted.
        return false;
    }
}

function getBatchRefusalDetail(result: BatchResult): string {
    return 'reason' in result ? result.reason : result.status;
}

function retainsPlacedMedia(result: BatchResult): boolean {
    return result.status === 'committed' || result.status === 'committed-with-warning' || result.status === 'ambiguous';
}

export async function applyAgentAuditionCandidate({
    receipt,
    trackId,
    startBeat,
}: ApplyAgentAuditionCandidateInput): Promise<ApplyAgentAuditionCandidateResult> {
    if (!isAudioTrack(trackId)) {
        return { status: 'rejected', reason: 'track-not-audio' };
    }

    const verified = await verifyAuditionedAudio(receipt);
    if (verified.status === 'rejected') {
        return { status: 'rejected', reason: verified.reason };
    }

    const assetTransfer = getAssetTransfer();
    const staged = await stageAuditionedAsset(assetTransfer, verified.file);
    if (staged === 'failed') {
        return { status: 'rejected', reason: 'asset-staging-failed' };
    }

    const plan: PlacementPlan = {
        buffer: verified.buffer,
        trackId,
        startBeat,
        endBeat: readClipEndBeat(verified.buffer, startBeat),
        clipName: receipt.candidate.displayName,
        staged,
        assetTransfer,
    };

    const placement = await attemptPlacement(plan);
    if (placement.status === 'failed') {
        return { status: 'rejected', reason: 'project-write-refused', detail: placement.detail };
    }

    const { audioBufferId, batchResult } = placement;
    if (!retainsPlacedMedia(batchResult)) {
        releasePreparedMedia(plan, audioBufferId);
        return { status: 'rejected', reason: 'project-write-refused', detail: getBatchRefusalDetail(batchResult) };
    }

    if (batchResult.status === 'ambiguous') {
        return {
            status: 'ambiguous',
            detail: batchResult.reason,
            audioBufferId,
            contentAddress: receipt.contentAddress,
            assetFinalized: finalizeStagedAsset(plan),
        };
    }

    return {
        status: 'applied',
        audioBufferId,
        contentAddress: receipt.contentAddress,
        clipName: plan.clipName,
        startBeat,
        endBeat: plan.endBeat,
        assetFinalized: finalizeStagedAsset(plan),
    };
}
