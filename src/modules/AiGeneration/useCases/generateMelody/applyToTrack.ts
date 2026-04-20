import { addClip } from '#/modules/Arrangement/useCases';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases';

import { type GenerateMelodyOptions } from './algorithm';
import { generateMelody } from './algorithm';

export type ApplyMelodyResult = {
    clipId: string;
    noteCount: number;
};

export function applyMelodyToTrack(
    trackId: string,
    options: GenerateMelodyOptions,
    startBeat: number = 0
): ApplyMelodyResult | null {
    const bars = options.bars ?? 4;
    const totalBeats = bars * 4;

    const scaleName = options.scale.charAt(0).toUpperCase() + options.scale.slice(1);
    const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const keyName = keyNames[options.key % 12] ?? 'C';

    const clip = addClip({
        trackId,
        startBeat,
        endBeat: startBeat + totalBeats,
        name: `${options.style} melody (${keyName} ${scaleName})`,
        type: 'midi',
    });

    if (!clip) {
        return null;
    }

    const MIN_NOTE_DURATION = 0.25;
    const { notes } = generateMelody(options);
    // §14.4 — single-shot store write (see `applyChordProgressionToTrack`).
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
