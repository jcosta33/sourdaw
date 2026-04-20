import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { commitUndoEntry, createCallbackUndoEntry } from '#/modules/Command/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { trackStore } from '../stores/trackStore';

import { addClip } from './clip/addClip';

export async function importAudioFile(file: File): Promise<void> {
    let bufferId: string;
    let buffer: AudioBuffer;

    try {
        const result = await decodeAudioFile(file);
        bufferId = result.id;
        buffer = result.buffer;
    } catch {
        notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        return;
    }

    const state = getTrackState();
    if (!state) {
        return;
    }

    const transport = getTransportState();
    const tempo = transport?.tempo ?? 120;
    const durationBeats = (buffer.duration / 60) * tempo;
    const endBeat = Math.ceil(durationBeats / 4) * 4;
    const name = file.name.replace(/\.[^.]+$/, '');

    // Register the blob with AssetTransfer if a collaboration session is active,
    // so peers can request it by hash. addLocalAsset is a no-op when null.
    const assetHash = await getAssetTransfer()?.addLocalAsset(file, file.name);

    // The track store is immutable-via-set — every .set() yields a new
    // top-level object, so capturing the reference before/after is
    // equivalent to structuredClone() but without the O(n) deep-copy hit
    // that used to block the main thread twice per import (§77.1).
    const trackSnapshotBefore = trackStore.value;

    const track = createTrack({ name, kind: 'audio' });

    // Add the track to the store first so that addClip can find it
    setTrackState({ ...state, tracks: [...state.tracks, track] });

    addClip({
        trackId: track.id,
        startBeat: 0,
        endBeat: Math.max(4, endBeat),
        name,
        type: 'audio',
        audioBufferId: bufferId,
        assetHash,
    });

    const trackSnapshotAfter = trackStore.value;

    commitUndoEntry(
        createCallbackUndoEntry(
            `Import audio: ${name}`,
            () => {
                if (trackSnapshotBefore) {
                    trackStore.set(trackSnapshotBefore);
                }
            },
            () => {
                if (trackSnapshotAfter) {
                    trackStore.set(trackSnapshotAfter);
                }
            }
        )
    );
}
