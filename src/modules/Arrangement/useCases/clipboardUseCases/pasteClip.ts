import { getTrackState } from '#/modules/Arrangement/repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { addClip } from '#/modules/Arrangement/useCases/clipUseCases';
import { type MidiNote, createMidiNote } from '#/modules/Arrangement/useCases/trackQueries';
import { clipClipboard } from '#/modules/Arrangement/stores/clipboardStore';

export function pasteClip(): void {
    if (clipClipboard.length === 0) {
        return;
    }

    const transport = getTransportState();
    const trackState = getTrackState();
    if (!transport || !trackState) {
        return;
    }

    const playheadBeat = playheadPositionRef.current;
    const minStartBeat = Math.min(...clipClipboard.map((e) => e.clip.startBeat));
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
            const copiedNotes: MidiNote[] = entry.midiNotes.map((n) =>
                createMidiNote(n.pitch, n.startBeat, n.duration, n.velocity)
            );

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
