import { addClip } from '#/modules/Arrangement/useCases/clip';
import { addMidiNote } from '#/modules/MIDI/useCases/midi';
import { type GenerateMelodyOptions } from './algorithm';
import { generateMelody } from './algorithm';

export function applyMelodyToTrack(trackId: string, options: GenerateMelodyOptions): void {
    const bars = options.bars ?? 4;
    const totalBeats = bars * 4;

    const scaleName = options.scale.charAt(0).toUpperCase() + options.scale.slice(1);
    const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const keyName = keyNames[options.key % 12] ?? 'C';

    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: totalBeats,
        name: `${options.style} melody (${keyName} ${scaleName})`,
        type: 'midi',
    });

    if (!clip) {
        return;
    }

    const { notes } = generateMelody(options);
    for (const note of notes) {
        addMidiNote(clip.id, note.pitch, note.startBeat, note.duration, note.velocity);
    }
}
