import { getTrackById, updateTrack } from '../repositories/trackRepository';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { addTrack } from './addTrack';
import { addClip } from '#/modules/Arrangement/useCases/clipUseCases';
import { type MidiNote } from '#/modules/Arrangement/useCases/trackQueries';

export function duplicateTrack(trackId: string): void {
    const source = getTrackById(trackId);
    if (!source) {
        return;
    }

    const newTrack = addTrack({ name: `${source.name} (copy)`, kind: source.kind });
    if (!newTrack) {
        return;
    }

    for (const clip of source.clips) {
        const newClip = addClip({
            trackId: newTrack.id,
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            name: clip.name,
            type: clip.type,
            audioBufferId: clip.audioBufferId,
        });

        if (newClip && clip.type === 'midi') {
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
        updateTrack(newTrack.id, (t) => ({
            ...t,
            devices: [
                ...t.devices,
                { ...device, id: `device-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
            ],
        }));
    }
}
