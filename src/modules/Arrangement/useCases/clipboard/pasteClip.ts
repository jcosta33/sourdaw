import { midiStore } from '#/modules/MIDI/stores';
import { playheadPositionRef } from '#/modules/Transport/stores';
import { getTransportState } from '#/modules/Transport/useCases';

import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { getTrackState } from '../../repositories/track/getTrackState';
import { clipboardStore } from '../../stores/clipboardStore';
import { addClip } from '../clip/addClip';

export function pasteClip(): void {
    const clipClipboard = clipboardStore.value?.clipClipboard ?? [];
    if (clipClipboard.length === 0) {
        return;
    }

    const transport = getTransportState();
    const trackState = getTrackState();
    if (!transport || !trackState) {
        return;
    }

    const playheadBeat = playheadPositionRef.current;
    let minStartBeat = Infinity;
    for (const e of clipClipboard) {
        if (e.clip.startBeat < minStartBeat) {
            minStartBeat = e.clip.startBeat;
        }
    }
    const offset = playheadBeat - minStartBeat;

    for (const entry of clipClipboard) {
        const targetTrackId = trackState.selectedTrackId ?? entry.sourceTrackId;
        const targetTrack = trackState.tracks.find((t) => t.id === targetTrackId);
        if (!targetTrack) {
            continue;
        }

        const newClip = addClip({
            trackId: targetTrackId,
            startBeat: entry.clip.startBeat + offset,
            endBeat: entry.clip.endBeat + offset,
            name: `${entry.clip.name} (paste)`,
            type: entry.clip.type,
            audioBufferId: entry.clip.audioBufferId,
        });

        if (!newClip) {
            continue;
        }

        if (entry.midiNotes && entry.midiNotes.length > 0) {
            const copiedNotes: MidiNote[] = entry.midiNotes.map((n) => ({
                ...n,
                id: `note-${crypto.randomUUID().slice(0, 8)}`,
            }));

            const midiState = midiStore.value;
            if (midiState) {
                midiStore.set({
                    ...midiState,
                    notesByClipId: {
                        ...midiState.notesByClipId,
                        [newClip.id]: copiedNotes,
                    },
                });
            }
        }
    }
}
