import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { audioToMidi } from '#/modules/AudioAnalysis';
import type { ExtractAction } from '../types';

export const executeAudioToMidi = inject({ audioToMidi })(
    ({ audioToMidi }) =>
        function executeAudioToMidi(a: ExtractAction<AppAction, 'audioToMidi'>): void {
            audioToMidi({
                clipId: a.payload.clipId,
                trackId: a.payload.trackId ?? '',
                sensitivity: a.payload.sensitivity,
                mode: (a.payload.mode as 'rhythm' | 'pitched') ?? 'rhythm',
            });
        }
);

export const handleAudioToMidi = createHandler<'audioToMidi'>({
    execute: executeAudioToMidi,
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
