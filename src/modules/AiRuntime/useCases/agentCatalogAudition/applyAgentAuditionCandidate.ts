import { cacheAudioBuffer, decodeAudioFileBuffer, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';
import { DEFAULT_TEMPO_BPM, transportStore } from '#/modules/Transport/stores';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { type AgentAuditionRender } from './auditionAgentCatalogCandidate';

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
    readonly render: AgentAuditionRender;
    readonly trackId: string;
    readonly startBeat: number;
};

type ApplyAgentAuditionRejectionReason =
    | 'unknown-catalog-id'
    | 'file-unavailable'
    | 'undecodable-audio'
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

async function decodeCandidateFile(file: File): Promise<AudioBuffer | null> {
    try {
        return await decodeAudioFileBuffer(file);
    } catch {
        return null;
    }
}

async function verifyAuditionedAudio(render: AgentAuditionRender): Promise<VerifiedAudio> {
    const resolved = await resolveAgentCatalogCandidate({ candidateId: render.candidateId });
    if (resolved.status === 'rejected') {
        return { status: 'rejected', reason: resolved.reason };
    }

    const buffer = await decodeCandidateFile(resolved.file);
    if (!buffer) {
        return { status: 'rejected', reason: 'undecodable-audio' };
    }
    if (buffer.duration <= 0) {
        return { status: 'rejected', reason: 'empty-audio' };
    }

    const contentAddress = await getAudioBufferContentAddress(buffer);
    if (contentAddress !== render.contentAddress) {
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

function buildAddClipPayload(input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    clipName: string;
    audioBufferId: string;
    staged: StagedAsset | undefined;
}): AddClipPayload {
    const payload: AddClipPayload = {
        trackId: input.trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        name: input.clipName,
        type: 'audio',
        audioBufferId: input.audioBufferId,
    };
    if (!input.staged) {
        return payload;
    }
    return { ...payload, assetHash: input.staged.hash };
}

function finalizeStagedAsset(assetTransfer: AssetTransfer, staged: StagedAsset | undefined): boolean {
    if (!staged) {
        return false;
    }
    try {
        assetTransfer?.promoteStagedAsset(staged.leaseId);
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
    render,
    trackId,
    startBeat,
}: ApplyAgentAuditionCandidateInput): Promise<ApplyAgentAuditionCandidateResult> {
    const verified = await verifyAuditionedAudio(render);
    if (verified.status === 'rejected') {
        return { status: 'rejected', reason: verified.reason };
    }

    const assetTransfer = getAssetTransfer();
    const staged = await stageAuditionedAsset(assetTransfer, verified.file);
    if (staged === 'failed') {
        return { status: 'rejected', reason: 'asset-staging-failed' };
    }

    const clipName = render.candidate.displayName;
    const endBeat = readClipEndBeat(verified.buffer, startBeat);
    const audioBufferId = cacheAudioBuffer({ buffer: verified.buffer });
    const batchResult = await executeAppActionBatch(
        [
            {
                type: 'addClip',
                payload: buildAddClipPayload({ trackId, startBeat, endBeat, clipName, audioBufferId, staged }),
            },
        ],
        {
            groupId: `agent-audition-${crypto.randomUUID()}`,
            groupLabel: `Place auditioned sample: ${clipName}`,
            source: 'ai',
            requireCompensation: true,
        }
    );

    if (!retainsPlacedMedia(batchResult)) {
        discardDecodedAudioFile(audioBufferId);
        if (staged) {
            assetTransfer?.releaseStagedAsset(staged.leaseId);
        }
        return { status: 'rejected', reason: 'project-write-refused', detail: getBatchRefusalDetail(batchResult) };
    }

    return {
        status: 'applied',
        audioBufferId,
        contentAddress: render.contentAddress,
        clipName,
        startBeat,
        endBeat,
        assetFinalized: finalizeStagedAsset(assetTransfer, staged),
    };
}
