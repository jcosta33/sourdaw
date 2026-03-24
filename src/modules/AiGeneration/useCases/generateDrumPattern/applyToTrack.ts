import { addClip } from '#/modules/Arrangement/useCases/clipUseCases';
import { addMidiNote } from '#/modules/MIDI/useCases/midiUseCases';
import { type GenerateDrumPatternOptions } from './algorithm';
import { generateDrumPattern } from './algorithm';

export function applyDrumPatternToTrack(trackId: string, options: GenerateDrumPatternOptions): void {
    const bars = options.bars ?? 4;
    const [numerator] = options.timeSignature ?? [4, 4];
    const totalBeats = bars * numerator;

    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: totalBeats,
        name: `${options.style} drums`,
        type: 'midi',
    });

    if (!clip) {
        return;
    }

    const { notes } = generateDrumPattern(options);
    for (const note of notes) {
        addMidiNote(clip.id, note.pitch, note.startBeat, note.duration, note.velocity);
    }
}
