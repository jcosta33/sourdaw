import { addClip } from '#/modules/Arrangement/useCases/clipUseCases';
import { addMidiNote } from '#/modules/MIDI/useCases/midiUseCases';
import { type GenerateChordProgressionOptions } from './algorithm';
import { generateChordProgression } from './algorithm';

export function applyChordProgressionToTrack(trackId: string, options: GenerateChordProgressionOptions): void {
    const bars = options.bars ?? 4;
    const totalBeats = bars * 4;

    const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const keyName = keyNames[options.key % 12] ?? 'C';
    const scaleName = options.scale.charAt(0).toUpperCase() + options.scale.slice(1);

    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: totalBeats,
        name: `${options.style} chords (${keyName} ${scaleName})`,
        type: 'midi',
    });

    if (!clip) {
        return;
    }

    const { notes } = generateChordProgression(options);
    for (const note of notes) {
        addMidiNote(clip.id, note.pitch, note.startBeat, note.duration, note.velocity);
    }
}
