import { trackStore } from "../stores/trackStore";
import { midiStore } from "../stores/midiStore";
import { addTrack } from "./addTrack";
import { addClip } from "./clipUseCases";
import type { MidiNote } from "../models/MidiNote";

export const duplicateTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    const source = state.tracks.find((t) => t.id === trackId);
    if (!source) return;

    const newTrack = addTrack({ name: `${source.name} (copy)`, kind: source.kind });
    if (!newTrack) return;

    for (const clip of source.clips) {
        const newClip = addClip({
            trackId: newTrack.id,
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            name: clip.name,
            type: clip.type,
            audioBufferId: clip.audioBufferId,
        });

        if (newClip && clip.type === "midi") {
            const midiState = midiStore.value;
            const sourceNotes = midiState?.notesByClipId[clip.id];
            if (sourceNotes && sourceNotes.length > 0) {
                const copiedNotes: MidiNote[] = sourceNotes.map((n) => ({
                    ...n,
                    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                }));
                const currentMidi = midiStore.value;
                midiStore.set({
                    notesByClipId: {
                        ...(currentMidi?.notesByClipId ?? {}),
                        [newClip.id]: copiedNotes,
                    },
                    ccByClipId: currentMidi?.ccByClipId ?? {},
                    pitchBendByClipId: currentMidi?.pitchBendByClipId ?? {},
                });
            }
        }
    }

    for (const device of source.devices) {
        const ts = trackStore.value;
        if (!ts) break;
        trackStore.set({
            ...ts,
            tracks: ts.tracks.map((t) =>
                t.id === newTrack.id
                    ? {
                        ...t,
                        devices: [
                            ...t.devices,
                            { ...device, id: `device-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
                        ],
                    }
                    : t,
            ),
        });
    }
};
