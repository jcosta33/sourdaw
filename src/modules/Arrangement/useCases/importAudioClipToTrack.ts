import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { DEFAULT_TEMPO_BPM, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackById } from '../repositories/track/getTrackById';

import { addClip } from './clip/addClip';

type ImportAudioClipToTrackOptions = {
    shouldContinue: () => boolean;
};

type ImportAudioClipToTrackOutput = 'completed' | 'superseded';

type StagedImportAsset = { hash: string; leaseId: string };

type AssetTransfer = ReturnType<typeof getAssetTransfer>;

/**
 * Stage the imported file with the collaboration asset owner — session or
 * durable project runtime — producing the `assetHash` a receiving peer needs
 * to request and verify these bytes (#3759). `null` means no owner accepted
 * the registration question; a real staging failure returns `'failed'`
 * rather than throwing: an import whose bytes cannot be registered must not
 * publish a clip a peer would receive as permanently silent audio.
 */
async function stageImportAsset(
    assetTransfer: AssetTransfer,
    file: File
): Promise<StagedImportAsset | 'failed' | null> {
    if (!assetTransfer) {
        return null;
    }
    try {
        const staged = await assetTransfer.stageLocalAsset(file, file.name);
        return { hash: staged.hash, leaseId: staged.leaseId };
    } catch {
        return 'failed';
    }
}

export async function importAudioClipToTrack(
    trackId: string,
    file: File,
    { shouldContinue }: ImportAudioClipToTrackOptions
): Promise<ImportAudioClipToTrackOutput> {
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

    const track = getTrackById(trackId);
    if (!track) {
        discardDecodedAudioFile(bufferId);
        return 'completed';
    }

    const transport = transportStore.value;
    const tempo = transport?.tempo ?? DEFAULT_TEMPO_BPM;
    const durationBeats = Math.ceil((buffer.duration / 60) * tempo);
    const lastClipEnd = Math.max(0, ...track.clips.map((context) => context.endBeat));
    const name = file.name.replace(/\.[^.]+$/, '');

    const assetTransfer = getAssetTransfer();
    const stagedResult = await stageImportAsset(assetTransfer, file);
    if (stagedResult === 'failed') {
        discardDecodedAudioFile(bufferId);
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — asset registration failed`, 'error');
        return 'completed';
    }
    const stagedAsset = stagedResult;

    const releasePreparedResources = (): void => {
        if (stagedAsset) {
            assetTransfer?.releaseStagedAsset(stagedAsset.leaseId);
        }
        discardDecodedAudioFile(bufferId);
    };

    if (!shouldContinue()) {
        releasePreparedResources();
        return 'superseded';
    }

    let clip: ReturnType<typeof addClip> = null;
    try {
        clip = addClip({
            trackId,
            startBeat: lastClipEnd,
            endBeat: lastClipEnd + durationBeats,
            name,
            type: 'audio',
            audioBufferId: bufferId,
            assetHash: stagedAsset?.hash,
        });
    } catch {
        // The decoded buffer remains owned by this import until a clip accepts
        // it; `clip` keeps its null initializer when addClip throws.
    }
    if (clip) {
        let assetFinalizationFailed = false;
        if (stagedAsset) {
            try {
                assetTransfer?.promoteStagedAsset(stagedAsset.leaseId);
            } catch {
                assetFinalizationFailed = true;
            }
        }
        if (assetFinalizationFailed && shouldContinue()) {
            notifyUser(`Imported "${file.name}", but its audio asset could not be finalized`, 'warning');
        }
        return 'completed';
    }

    releasePreparedResources();
    if (shouldContinue()) {
        notifyUser(`Failed to import "${file.name}" — project state could not be updated`, 'error');
    } else {
        return 'superseded';
    }

    return 'completed';
}
