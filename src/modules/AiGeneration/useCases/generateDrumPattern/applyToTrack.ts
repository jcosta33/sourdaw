import { inject } from '#/infra/di/inject';
import { addClip } from '#/modules/Arrangement';
import { addMidiNote } from '#/modules/MIDI';
import { type GenerateDrumPatternOptions } from './algorithm';
import { generateDrumPattern } from './algorithm';

export const applyDrumPatternToTrackDependencies = {
    addClip,
    addMidiNote,
} as const;

export const applyDrumPatternToTrack = inject(applyDrumPatternToTrackDependencies)(
    ({ addClip, addMidiNote }) =>
        function applyDrumPatternToTrack(
            trackId: string,
            options: GenerateDrumPatternOptions,
            startBeat: number = 0
        ): void {
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
                return;
            }

            const { notes } = generateDrumPattern(options);
            for (const note of notes) {
                addMidiNote(clip.id, note.pitch, startBeat + note.startBeat, note.duration, note.velocity);
            }
        }
);
