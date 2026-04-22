import { addClip } from '#/modules/Arrangement/useCases';
import { batchAddMidiNotes } from '#/modules/MIDI/useCases';

import { type GenerateDrumPatternOptions } from './algorithm';
import { generateDrumPattern } from './algorithm';

export type ApplyDrumPatternResult = {
    clipId: string;
    noteCount: number;
};

export function applyDrumPatternToTrack(
    trackId: string,
    options: GenerateDrumPatternOptions,
    startBeat: number = 0
): ApplyDrumPatternResult | null {
    const bars = options.bars ?? 4;
    const [numerator] = options.timeSignature ?? [4, 4];
    const totalBeats = bars * numerator;

    const clip = addClip({
        trackId,
        startBeat,
        endBeat: startBeat + totalBeats,
        name: `${options.style} drums`,
        type: 'midi',
    });

    if (!clip) {
        return null;
    }

    const { notes } = generateDrumPattern(options);
    // §14.4 — single-shot store write (see `applyChordProgressionToTrack`).
    batchAddMidiNotes(
        clip.id,
        notes.map((note) => ({
            pitch: note.pitch,
            startBeat: note.startBeat,
            duration: note.duration,
            velocity: note.velocity,
        }))
    );

    return { clipId: clip.id, noteCount: notes.length };
}
