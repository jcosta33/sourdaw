import { inject } from '#/infra/di/inject';
import { createCallbackUndoEntry, pushUndo } from '#/modules/Command';
import { midiStore, readMidiFile } from '#/modules/MIDI';
import { type Clip, trackStore } from '../stores/trackStore';
import { createTrack } from './createTrack';
import { getNextClipId } from './getNextClipId';
import { getTrackStoreState } from './getTrackStoreState';
import { setTrackState } from './setTrackState';

const importMidiFileDependencies = {
    getTrackStoreState,
    setTrackState,
    createTrack,
    getNextClipId,
    pushUndo,
    createCallbackUndoEntry,
    trackStore,
    midiStore,
    readMidiFile,
} as const;

export const importMidiFile = inject(importMidiFileDependencies)(
    ({
        getTrackStoreState,
        setTrackState,
        createTrack,
        getNextClipId,
        pushUndo,
        createCallbackUndoEntry,
        trackStore,
        midiStore,
        readMidiFile,
    }) =>
        async function importMidiFile(file: File): Promise<void> {
            const parsedTracks = await readMidiFile(file);
            if (parsedTracks.length === 0) {
                return;
            }

            const state = getTrackStoreState();
            if (!state) {
                return;
            }

            const trackSnapshotBefore = structuredClone(trackStore.value);
            const midiSnapshotBefore = structuredClone(midiStore.value);

            const newMidiData: Record<string, (typeof parsedTracks)[number]['notes']> = {
                ...(midiStore.value?.notesByClipId ?? {}),
            };

            const tracksWithClips = parsedTracks.map((parsedTrack) => {
                const track = createTrack({ name: parsedTrack.name, kind: 'midi' });
                const maxBeat = Math.max(...parsedTrack.notes.map((note) => note.startBeat + note.duration), 4);
                const endBeat = Math.ceil(maxBeat / 4) * 4;
                const clip: Clip = {
                    id: getNextClipId(),
                    trackId: track.id,
                    name: parsedTrack.name,
                    startBeat: 0,
                    endBeat,
                    type: 'midi',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '',
                    locked: false,
                    muted: false,
                };
                newMidiData[clip.id] = parsedTrack.notes;
                return { ...track, clips: [clip] };
            });

            const trackState = getTrackStoreState();
            if (trackState) {
                setTrackState({
                    ...trackState,
                    tracks: [...trackState.tracks, ...tracksWithClips],
                });
            }

            midiStore.set({
                notesByClipId: newMidiData,
                ccByClipId: midiStore.value?.ccByClipId ?? {},
                pitchBendByClipId: midiStore.value?.pitchBendByClipId ?? {},
            });

            const trackSnapshotAfter = structuredClone(trackStore.value);
            const midiSnapshotAfter = structuredClone(midiStore.value);
            const importedName =
                parsedTracks.length === 1
                    ? (parsedTracks[0]?.name ?? 'MIDI file')
                    : `${parsedTracks.length} MIDI tracks`;

            pushUndo(
                createCallbackUndoEntry(
                    `Import MIDI: ${importedName}`,
                    () => {
                        if (trackSnapshotBefore) {
                            trackStore.set(trackSnapshotBefore);
                        }
                        if (midiSnapshotBefore) {
                            midiStore.set(midiSnapshotBefore);
                        }
                    },
                    () => {
                        if (trackSnapshotAfter) {
                            trackStore.set(trackSnapshotAfter);
                        }
                        if (midiSnapshotAfter) {
                            midiStore.set(midiSnapshotAfter);
                        }
                    }
                )
            );
        }
);
