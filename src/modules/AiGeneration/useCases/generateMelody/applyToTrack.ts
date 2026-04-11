import { inject } from '#/infra/di/inject';
import { addClip } from '#/modules/Arrangement/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { type GenerateMelodyOptions } from './algorithm';
import { generateMelody } from './algorithm';

export const applyMelodyToTrack = inject({
    addClip,
    addMidiNote,
})(
    ({ addClip, addMidiNote }) =>
        function applyMelodyToTrack(trackId: string, options: GenerateMelodyOptions, startBeat: number = 0): void {
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
                return;
            }

            const MIN_NOTE_DURATION = 0.25;
            const { notes } = generateMelody(options);
            for (const note of notes) {
                const duration = Math.max(MIN_NOTE_DURATION, note.duration);
                addMidiNote(clip.id, note.pitch, startBeat + note.startBeat, duration, note.velocity);
            }
        }
);
