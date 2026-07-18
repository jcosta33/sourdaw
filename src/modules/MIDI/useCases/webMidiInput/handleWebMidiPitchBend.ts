import { inject } from '#/infra/di/inject';
import { audioEngine } from '#/modules/AudioEngine/useCases';

import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

const STANDARD_BEND_RANGE_CENTS = 200;
const MPE_BEND_RANGE_CENTS = 48 * 100;

export const handleWebMidiPitchBend = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handleWebMidiPitchBend(channel: number, lsb: number, msb: number): void {
            const bendValue = ((msb << 7) | lsb) - 8192;

            if (getMpeEnabled() && channel >= 1) {
                const noteForChannel = channelToNote.get(channel);
                if (noteForChannel === undefined) {
                    return;
                }
                const noteData = activeNotes.get(noteForChannel);
                if (!noteData) {
                    return;
                }
                noteData.pitchBend = bendValue;
                if (noteData.osc) {
                    const bendCents = (bendValue / 8192) * MPE_BEND_RANGE_CENTS;
                    const baseDetune = getTargetTrackId() ? deps.getSynthParamsForTrack(getTargetTrackId()!).detune : 0;
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, audioEngine.context.currentTime, 0.003);
                }
                return;
            }

            const bendCents = (bendValue / 8192) * STANDARD_BEND_RANGE_CENTS;
            const baseDetune = getTargetTrackId() ? deps.getSynthParamsForTrack(getTargetTrackId()!).detune : 0;
            const now = audioEngine.context.currentTime;
            for (const noteData of activeNotes.values()) {
                if (noteData.osc) {
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, now, 0.003);
                }
            }
        }
);
