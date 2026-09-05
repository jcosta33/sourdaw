import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { trackStore } from '../stores/trackStore';

import { addClip } from './clip/addClip';

type ImportAudioFileOptions = {
    shouldContinue: () => boolean;
};

type ImportAudioFileOutput = 'completed' | 'superseded';

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
    let stagedAsset: Awaited<ReturnType<NonNullable<typeof assetTransfer>['stageLocalAsset']>> | undefined;
    try {
        stagedAsset = await assetTransfer?.stageLocalAsset(file, file.name);
    } catch {
        discardDecodedAudioFile(bufferId);
        if (!shouldContinue()) {
            return 'superseded';
        }
        notifyUser(`Failed to import "${file.name}" — asset registration failed`, 'error');
        return 'completed';
    }

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
    const freshState = getTrackState();
    if (!freshState) {
        releasePreparedResources();
        return 'completed';
    }

    const trackSnapshotBefore = freshState;

    try {
        // Add the track to the store first so that addClip can find it.
        setTrackState({ ...freshState, tracks: [...freshState.tracks, track] });

        const clip = addClip({
            trackId: track.id,
            startBeat: 0,
            endBeat: Math.max(4, endBeat),
            name,
            type: 'audio',
            audioBufferId: bufferId,
            assetHash: stagedAsset?.hash,
        });

        if (!clip) {
            throw new Error('Imported audio clip was not committed');
        }

        const trackSnapshotAfter = trackStore.value;
        pushUndoEntry(
            `Import audio: ${name}`,
            () => {
                trackStore.set(trackSnapshotBefore);
            },
            () => {
                if (trackSnapshotAfter) {
                    trackStore.set(trackSnapshotAfter);
                }
            }
        );
    } catch {
        setTrackState(trackSnapshotBefore);
        releasePreparedResources();
        notifyUser(`Failed to import "${file.name}" — project state could not be updated`, 'error');
        return 'completed';
    }

    if (stagedAsset) {
        assetTransfer?.promoteStagedAsset(stagedAsset.leaseId);
    }

    return 'completed';
}
