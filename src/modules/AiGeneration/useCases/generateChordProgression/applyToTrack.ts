import { addClip } from '#/modules/Arrangement/useCases';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases';

import { type GenerateChordProgressionOptions } from './algorithm';
import { generateChordProgression } from './algorithm';

export type ApplyChordProgressionResult = {
    clipId: string;
    noteCount: number;
};

export function applyChordProgressionToTrack(
    trackId: string,
    options: GenerateChordProgressionOptions,
    startBeat: number = 0
): ApplyChordProgressionResult | null {
    const bars = options.bars ?? 4;
    const totalBeats = bars * 4;

    const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const keyName = keyNames[options.key % 12] ?? 'C';
    const scaleName = options.scale.charAt(0).toUpperCase() + options.scale.slice(1);

    const clip = addClip({
        trackId,
        startBeat,
        endBeat: startBeat + totalBeats,
        name: `${options.style} chords (${keyName} ${scaleName})`,
        type: 'midi',
    });

    if (!clip) {
        return null;
    }

    const MIN_NOTE_DURATION = 0.25;
    const { notes } = generateChordProgression(options);
    // §14.4 — single-shot store write. `addMidiNote` in a loop fires one
    // `midiStore.set(...)` per note, which becomes visibly janky on long
    // progressions (e.g. a 12-bar blues = 48+ notes).
    batchAddMidiNotes(
        clip.id,
        notes.map((note) => ({
            pitch: note.pitch,
            startBeat: note.startBeat,
            duration: Math.max(MIN_NOTE_DURATION, note.duration),
            velocity: note.velocity,
        }))
    );

    return { clipId: clip.id, noteCount: notes.length };
}
