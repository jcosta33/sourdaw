import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';

type ImportAudioFileOptions = {
    shouldContinue: () => boolean;
};

type ImportAudioFileOutput = 'completed' | 'superseded';

type AudioImportBatchResult = Awaited<ReturnType<typeof executeAppActionBatch>>;
type AssetTransfer = ReturnType<typeof getAssetTransfer>;
type StagedAsset = Awaited<ReturnType<NonNullable<AssetTransfer>['stageLocalAsset']>>;

function getBatchFailureReason(result: AudioImportBatchResult): string {
    switch (result.status) {
        case 'no-op':
            return 'the import made no project change';
        case 'rejected':
        case 'conflicted':
        case 'cancelled':
        case 'failed':
            return result.reason;
        case 'executed':
        case 'executed-with-warning':
            return 'the project batch returned a runtime-only result';
        case 'committed':
        case 'committed-with-warning':
        case 'ambiguous':
            throw new Error(`Cannot read a failure reason from ${result.status}`);
    }
    throw new Error('Unhandled audio import batch result');
}

async function stageAudioAsset(assetTransfer: AssetTransfer, file: File): Promise<StagedAsset | 'failed' | undefined> {
    if (!assetTransfer) {
        return undefined;
    }
    try {
        return await assetTransfer.stageLocalAsset(file, file.name);
    } catch {
        return 'failed';
    }
}

function createAudioImportActions(input: {
    track: ReturnType<typeof createTrack>;
    name: string;
    endBeat: number;
    bufferId: string;
    stagedAsset?: StagedAsset;
}): Parameters<typeof executeAppActionBatch>[0] {
    const { track, name, endBeat, bufferId, stagedAsset } = input;
    return [
        {
            type: 'addTrack',
            payload: {
                id: track.id,
                name: track.name,
                kind: track.kind,
                color: track.color,
                initialAlternativeId: track.activeAlternativeId,
                select: false,
            },
        },
        {
            type: 'addClip',
            payload: {
                trackId: track.id,
                startBeat: 0,
                endBeat: Math.max(4, endBeat),
                name,
                type: 'audio',
                audioBufferId: bufferId,
                ...(stagedAsset ? { assetHash: stagedAsset.hash } : {}),
            },
        },
    ];
}

async function runAudioImportBatch(
    actions: Parameters<typeof executeAppActionBatch>[0],
    groupLabel: string,
    shouldContinue: () => boolean
): Promise<AudioImportBatchResult | null> {
    try {
        return await executeAppActionBatch(actions, {
            groupId: `import-audio-${crypto.randomUUID()}`,
            groupLabel,
            source: 'manual',
            requireCompensation: true,
            shouldExecute: shouldContinue,
        });
    } catch {
        return null;
    }
}

function finalizeCommittedAudioImport(input: {
    file: File;
    batchResult: AudioImportBatchResult;
    assetTransfer: AssetTransfer;
    stagedAsset?: StagedAsset;
    shouldContinue: () => boolean;
}): ImportAudioFileOutput {
    const { file, batchResult, assetTransfer, stagedAsset, shouldContinue } = input;
    let assetFinalizationFailed = false;
    try {
        if (stagedAsset) {
            assetTransfer?.promoteStagedAsset(stagedAsset.leaseId);
        }
    } catch {
        assetFinalizationFailed = true;
    }

    if (!shouldContinue()) {
        return 'superseded';
    }
    if (assetFinalizationFailed) {
        notifyUser(`Imported "${file.name}", but its audio asset could not be finalized`, 'warning');
    }
    if (batchResult.status === 'committed-with-warning') {
        notifyUser(`Imported "${file.name}" with a project warning: ${batchResult.warning}`, 'warning');
    } else if (batchResult.status === 'ambiguous') {
        notifyUser(`Import of "${file.name}" may have committed: ${batchResult.reason}`, 'warning');
    }
    return 'completed';
}

export async function importAudioFile(
    file: File,
    { shouldContinue }: ImportAudioFileOptions
): Promise<ImportAudioFileOutput> {
    let bufferId: string;
    let buffer: AudioBuffer;

    try {
        const result = await decodeAudioFile(file);
        bufferId = result.id;
        buffer = result.buffer;
    } catch {
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        return 'completed';
    }

    if (!shouldContinue()) {
        discardDecodedAudioFile(bufferId);
        return 'superseded';
    }

    const state = getTrackState();
    if (!state) {
        discardDecodedAudioFile(bufferId);
        return 'completed';
    }

    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;
    const durationBeats = (buffer.duration / 60) * tempo;
    const endBeat = Math.ceil(durationBeats / 4) * 4;
    const name = file.name.replace(/\.[^.]+$/, '');

    const assetTransfer = getAssetTransfer();
    const stagedAssetResult = await stageAudioAsset(assetTransfer, file);
    if (stagedAssetResult === 'failed') {
        discardDecodedAudioFile(bufferId);
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — asset registration failed`, 'error');
        return 'completed';
    }
    const stagedAsset = stagedAssetResult;

    const releasePreparedResources = () => {
        if (stagedAsset) {
            assetTransfer?.releaseStagedAsset(stagedAsset.leaseId);
        }
        discardDecodedAudioFile(bufferId);
    };

    if (!shouldContinue()) {
        releasePreparedResources();
        return 'superseded';
    }

    const track = createTrack({ name, kind: 'audio' });

    // Re-read the track state after the staged asset hash so a
    // concurrent write that landed during the asset hash (another import, a
    // clip/device edit, a remote CRDT apply) is not clobbered by a stale
    // snapshot. importMidiFile re-reads the same way before its write.
    if (!getTrackState()) {
        releasePreparedResources();
        return 'completed';
    }

    const groupLabel = `Import audio: ${name}`;
    const actions = createAudioImportActions({ track, name, endBeat, bufferId, stagedAsset });
    const batchResult = await runAudioImportBatch(actions, groupLabel, shouldContinue);
    if (!batchResult) {
        releasePreparedResources();
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — project state could not be updated`, 'error');
        return 'completed';
    }

    const retainsImportedMedia =
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'ambiguous';
    if (!retainsImportedMedia) {
        releasePreparedResources();
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(
            `Failed to import "${file.name}" — project state could not be updated: ${getBatchFailureReason(batchResult)}`,
            'error'
        );
        return 'completed';
    }
    return finalizeCommittedAudioImport({ file, batchResult, assetTransfer, stagedAsset, shouldContinue });
}
