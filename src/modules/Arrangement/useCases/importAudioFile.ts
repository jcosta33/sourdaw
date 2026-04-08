import { inject } from '#/infra/di/inject';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { createTrack } from '../models/Track';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { decodeAudioFile } from '#/modules/AudioEngine';
import { getTransportState } from '#/modules/Transport';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { trackStore } from '../stores/trackStore';
import { pushUndo, createCallbackUndoEntry } from '#/modules/Command';
import { getAssetTransfer } from '#/modules/Collaboration';

export const importAudioFile = inject({ getTrackState, setTrackState })(
    ({ getTrackState, setTrackState }) =>
        async function importAudioFile(file: File): Promise<void> {
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

            const trackSnapshotBefore = structuredClone(trackStore.value);

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

            const trackSnapshotAfter = structuredClone(trackStore.value);

            pushUndo(
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
);
