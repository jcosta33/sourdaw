import { trackStore } from '#/modules/Arrangement/stores';
import {
    compileNewAudioTrackAction,
    createTrack,
    retainedCreation,
    stageClipAudioAsset,
} from '#/modules/Arrangement/useCases';
import {
    decodeAudioFile,
    discardDecodedAudioFileIfCurrent,
    getCachedAudioBuffer,
    openCachedAudioBufferHold,
    restoreUnpinnedAudioBuffersFromIdb,
} from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import {
    ensureFactorySampleBuffer,
    rememberLibraryAssetMapping,
    resolveDroppedSampleFile,
} from '#/modules/SampleLibrary/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

type LibrarySamplePayload = {
    name: string;
    id: string;
    path?: string;
    libraryRootId?: string;
    audioBufferId?: string;
    durationSeconds?: number;
};

/** The clip lands on `trackId` when it names an audio track, else on a new audio track named after the sample. */
type LibrarySamplePlacement = { trackId?: string; startBeat: number };

type PlaceLibrarySampleInput = {
    sample: LibrarySamplePayload;
    placement: LibrarySamplePlacement;
    /** The project transition the placement belongs to; once it is no longer current nothing is written or reported. */
    authority: { isCurrent: () => boolean };
    /** Names the undo group of the placement after the gesture that made it. */
    origin: 'timeline-drop' | 'browser-add';
    /** Read when the sample's length becomes known, so the clip spans it at the tempo in force then. */
    readTempo: () => number;
};

export const LIBRARY_SAMPLE_MALFORMED_MESSAGE = 'Could not place the dropped sample — its metadata was malformed.';

const BATCH_NAMING: Record<PlaceLibrarySampleInput['origin'], { groupIdPrefix: string; groupLabelPrefix: string }> = {
    'timeline-drop': { groupIdPrefix: 'timeline-drop', groupLabelPrefix: 'Drop sample' },
    'browser-add': { groupIdPrefix: 'browser-add', groupLabelPrefix: 'Add sample' },
};

type CreationBatchAction = Parameters<typeof executeAppActionBatch>[0][number];
type AssetTransfer = ReturnType<typeof getAssetTransfer>;
type Authority = PlaceLibrarySampleInput['authority'];
type AudioHold = ReturnType<typeof openCachedAudioBufferHold>;

/** A sample made ready to place: its audio, length, and the resources held until the clip commits or fails. */
type PreparedSample = {
    audioBuffer: AudioBuffer;
    audioBufferId: string;
    durationBeats: number;
    assetHash?: string;
    assetLeaseId?: string;
    decodedAudioBufferId?: string;
    rememberRawFileBinding?: () => Promise<boolean>;
};

/** `abandoned` means the failure was already reported and its resources released. */
type Preparation = { status: 'ready'; prepared: PreparedSample } | { status: 'abandoned' };

const ABANDONED: Preparation = { status: 'abandoned' };

type AudioTargetPlan = { trackId: string; newTrack: ReturnType<typeof createTrack> | undefined };

function resolveAudioTarget(placement: LibrarySamplePlacement, name: string): AudioTargetPlan | null {
    if (placement.trackId) {
        const target = trackStore.value?.tracks.find((candidate) => candidate.id === placement.trackId);
        return target?.kind === 'audio' ? { trackId: placement.trackId, newTrack: undefined } : null;
    }
    const track = createTrack({ name, kind: 'audio' });
    return { trackId: track.id, newTrack: track };
}

function beatsForSeconds(seconds: number, readTempo: () => number): number {
    return Math.max(1, Math.ceil((seconds / 60) * readTempo()));
}

function releasePrepared(prepared: PreparedSample, assetTransfer: AssetTransfer): void {
    if (prepared.assetLeaseId) {
        assetTransfer?.releaseStagedAsset(prepared.assetLeaseId);
    }
    if (prepared.decodedAudioBufferId) {
        discardDecodedAudioFileIfCurrent(prepared.decodedAudioBufferId, prepared.audioBuffer);
    }
}

function notifyIfCurrent(authority: Authority, message: string): void {
    if (authority.isCurrent()) {
        notifyUser(message, 'error');
    }
}

// Cached samples — factory content and already-decoded imports — have no file
// to re-read, so their PCM is encoded and staged here: the hash a receiving
// peer requests and verifies the bytes against (#3759).
async function prepareCachedSample(
    sample: LibrarySamplePayload,
    audioBufferId: string,
    buffer: AudioBuffer,
    authority: Authority,
    readTempo: () => number
): Promise<Preparation> {
    const durationBeats = beatsForSeconds(buffer.duration, readTempo);
    try {
        const staged = await stageClipAudioAsset(buffer, sample.name);
        return {
            status: 'ready',
            prepared: {
                audioBuffer: buffer,
                audioBufferId,
                durationBeats,
                assetHash: staged?.hash,
                assetLeaseId: staged?.leaseId,
            },
        };
    } catch {
        notifyIfCurrent(authority, `Failed to import "${sample.name}" — asset registration failed`);
        return ABANDONED;
    }
}

async function stageDecodedFile(
    sample: LibrarySamplePayload,
    file: File,
    decoded: PreparedSample,
    authority: Authority,
    assetTransfer: AssetTransfer
): Promise<Preparation> {
    try {
        const stagedAsset = await assetTransfer?.stageLocalAsset(file, file.name);
        const prepared: PreparedSample = {
            ...decoded,
            assetHash: stagedAsset?.hash,
            assetLeaseId: stagedAsset?.leaseId,
        };
        if (stagedAsset && sample.libraryRootId && sample.path) {
            const hash = stagedAsset.hash;
            const sampleId = sample.id;
            const libraryRootId = sample.libraryRootId;
            const relativePath = sample.path;
            prepared.rememberRawFileBinding = () =>
                rememberLibraryAssetMapping({
                    hash,
                    sampleId,
                    libraryRootId,
                    relativePath,
                    isCurrent: () => authority.isCurrent(),
                });
        }
        return { status: 'ready', prepared };
    } catch {
        releasePrepared(decoded, assetTransfer);
        notifyIfCurrent(authority, `Failed to import "${sample.name}" — asset registration failed`);
        return ABANDONED;
    }
}

async function decodeLibraryFile(
    sample: LibrarySamplePayload,
    file: File,
    authority: Authority,
    readTempo: () => number,
    hold: AudioHold
): Promise<PreparedSample | null> {
    try {
        const result = await decodeAudioFile(file, hold);
        return {
            audioBuffer: result.buffer,
            audioBufferId: result.id,
            decodedAudioBufferId: result.id,
            durationBeats: beatsForSeconds(result.buffer.duration, readTempo),
        };
    } catch {
        notifyIfCurrent(authority, `"${sample.name}" could not be decoded — the file may be DRM-protected or corrupt.`);
        return null;
    }
}

// The sample must survive read → decode → stage before anything is written to
// the project (#3756): any failure explains itself and leaves the project
// untouched instead of placing a clip with no audio behind it.
async function prepareLibraryFileSample(
    sample: LibrarySamplePayload,
    authority: Authority,
    assetTransfer: AssetTransfer,
    readTempo: () => number,
    hold: AudioHold
): Promise<Preparation> {
    if (!sample.libraryRootId || !sample.path) {
        notifyIfCurrent(authority, `Could not access "${sample.name}" — audio buffer is not available.`);
        return ABANDONED;
    }
    try {
        const resolvedSampleFile = await resolveDroppedSampleFile({
            libraryRootId: sample.libraryRootId,
            relativePath: sample.path,
            fallbackName: sample.name,
        });
        if (resolvedSampleFile.status !== 'resolved') {
            notifyIfCurrent(
                authority,
                `Could not access "${sample.name}" — its library folder is no longer available.`
            );
            return ABANDONED;
        }
        if (!authority.isCurrent()) {
            return ABANDONED;
        }
        const { file } = resolvedSampleFile;
        const decoded = await decodeLibraryFile(sample, file, authority, readTempo, hold);
        if (!decoded) {
            return ABANDONED;
        }
        if (!authority.isCurrent()) {
            releasePrepared(decoded, assetTransfer);
            return ABANDONED;
        }
        return await stageDecodedFile(sample, file, decoded, authority, assetTransfer);
    } catch {
        notifyIfCurrent(
            authority,
            `Could not access "${sample.name}" — the file may have moved or folder permissions were revoked.`
        );
        return ABANDONED;
    }
}

type SampleRestoration = {
    initiallyUncached: boolean;
    restoredBuffer: AudioBuffer | undefined;
};

// Factory (and any already-decoded) samples keep their AudioBuffer in the
// cache under the sample id — there is no file to re-read and the factory root
// is handle-less, so the SampleLibrary file resolver would have nothing to
// resolve. A cold gesture uses only the exact buffer its restoration returned;
// another same-ID cache entry is not that gesture's audio and is left alone.
async function prepareSample(
    sample: LibrarySamplePayload,
    authority: Authority,
    assetTransfer: AssetTransfer,
    readTempo: () => number,
    hold: AudioHold,
    restoration: SampleRestoration
): Promise<Preparation> {
    const candidateBufferId = sample.audioBufferId ?? sample.id;
    let cachedBuffer = getCachedAudioBuffer({ bufferId: candidateBufferId });
    if (restoration.initiallyUncached) {
        if (restoration.restoredBuffer) {
            cachedBuffer = restoration.restoredBuffer;
        } else if (cachedBuffer) {
            notifyIfCurrent(authority, `Could not place "${sample.name}" — its audio changed before placement.`);
            return ABANDONED;
        }
    }
    if (!cachedBuffer) {
        let rejectedFactoryCache = false;
        const factoryBuffer = await ensureFactorySampleBuffer({
            sampleId: candidateBufferId,
            ...(restoration.initiallyUncached
                ? {
                      shouldAdoptCachedBuffer: () => {
                          rejectedFactoryCache = true;
                          return false;
                      },
                  }
                : {}),
        });
        if (rejectedFactoryCache) {
            notifyIfCurrent(authority, `Could not place "${sample.name}" — its audio changed before placement.`);
            return ABANDONED;
        }
        if (factoryBuffer.status === 'unavailable') {
            notifyIfCurrent(authority, `Could not access "${sample.name}" — audio buffer is not available.`);
            return ABANDONED;
        }
        if (factoryBuffer.status === 'resolved') {
            cachedBuffer = factoryBuffer.buffer;
        }
    }
    if (!authority.isCurrent()) {
        return ABANDONED;
    }
    if (cachedBuffer) {
        return prepareCachedSample(sample, candidateBufferId, cachedBuffer, authority, readTempo);
    }
    return prepareLibraryFileSample(sample, authority, assetTransfer, readTempo, hold);
}

function buildPlacementActions(
    sample: LibrarySamplePayload,
    prepared: PreparedSample,
    placement: LibrarySamplePlacement,
    targetPlan: AudioTargetPlan
): CreationBatchAction[] {
    const actions: CreationBatchAction[] = [];
    if (targetPlan.newTrack) {
        actions.push(compileNewAudioTrackAction(targetPlan.newTrack));
    }
    actions.push({
        type: 'addClip',
        payload: {
            trackId: targetPlan.trackId,
            startBeat: placement.startBeat,
            endBeat: placement.startBeat + prepared.durationBeats,
            name: sample.name,
            type: 'audio',
            audioBufferId: prepared.audioBufferId,
            assetHash: prepared.assetHash,
        },
    });
    return actions;
}

async function promoteCommittedSample(
    prepared: PreparedSample,
    batchResult: Awaited<ReturnType<typeof executeAppActionBatch>> | null,
    authority: Authority,
    assetTransfer: AssetTransfer
): Promise<void> {
    if (!prepared.assetLeaseId) {
        return;
    }
    const promoted = assetTransfer?.promoteStagedAsset(prepared.assetLeaseId) === true;
    const fullyCommitted = batchResult?.status === 'committed' || batchResult?.status === 'committed-with-warning';
    if (promoted && prepared.rememberRawFileBinding && fullyCommitted && authority.isCurrent()) {
        await prepared.rememberRawFileBinding().catch(() => false);
    }
}

function isPreparedSampleCurrent(prepared: PreparedSample, authority: Authority): boolean {
    return authority.isCurrent() && getCachedAudioBuffer({ bufferId: prepared.audioBufferId }) === prepared.audioBuffer;
}

/**
 * Places a browser sample as one audio clip in one batch of registered
 * actions (one undo step, #4618). The sample is prepared first — cached or
 * factory buffer, else the library file decoded — and staged for sharing; any
 * failure there explains itself and leaves the project untouched. A staged
 * asset is promoted once on commit and released on every other path.
 */
export async function placeLibrarySample({
    sample,
    placement,
    authority,
    origin,
    readTempo,
}: PlaceLibrarySampleInput): Promise<void> {
    const assetTransfer = getAssetTransfer();
    let prepared: PreparedSample | null = null;
    let committed = false;
    let releaseAudio: (() => void) | undefined;
    const decodeHold = openCachedAudioBufferHold();
    try {
        const candidateBufferId = sample.audioBufferId ?? sample.id;
        const restored = await restoreUnpinnedAudioBuffersFromIdb({
            bufferIds: [candidateBufferId],
            isCurrent: authority.isCurrent,
        });
        releaseAudio = restored.release;
        if (!authority.isCurrent()) {
            return;
        }
        const preparation = await prepareSample(sample, authority, assetTransfer, readTempo, decodeHold, {
            initiallyUncached: restored.initiallyUncachedIds.includes(candidateBufferId),
            restoredBuffer: restored.restoredBuffers.get(candidateBufferId),
        });
        if (preparation.status === 'abandoned') {
            return;
        }
        const preparedSample = preparation.prepared;
        prepared = preparedSample;
        const canCommit = () => {
            const current = isPreparedSampleCurrent(preparedSample, authority);
            if (!current) {
                notifyIfCurrent(authority, `Could not place "${sample.name}" — its audio changed before placement.`);
            }
            return current;
        };
        if (!canCommit()) {
            releasePrepared(preparedSample, assetTransfer);
            return;
        }
        const targetPlan = resolveAudioTarget(placement, sample.name);
        if (!targetPlan) {
            releasePrepared(preparedSample, assetTransfer);
            return;
        }
        const naming = BATCH_NAMING[origin];
        const batchResult = await executeAppActionBatch(
            buildPlacementActions(sample, preparedSample, placement, targetPlan),
            {
                groupId: `${naming.groupIdPrefix}-${crypto.randomUUID()}`,
                groupLabel: `${naming.groupLabelPrefix}: ${sample.name}`,
                source: 'manual',
                requireCompensation: true,
                shouldExecute: canCommit,
            }
        ).catch(() => null);
        if (!retainedCreation(batchResult)) {
            releasePrepared(preparedSample, assetTransfer);
            return;
        }
        committed = true;
        await promoteCommittedSample(preparedSample, batchResult, authority, assetTransfer);
    } catch {
        if (prepared && !committed) {
            releasePrepared(prepared, assetTransfer);
        }
        notifyIfCurrent(authority, LIBRARY_SAMPLE_MALFORMED_MESSAGE);
    } finally {
        decodeHold.release();
        releaseAudio?.();
    }
}
