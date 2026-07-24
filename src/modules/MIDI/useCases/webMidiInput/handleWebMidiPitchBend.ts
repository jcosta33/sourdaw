import { inject } from '#/infra/di/inject';
import { applyNoteExpression, audioEngine } from '#/modules/AudioEngine/useCases';

import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

const STANDARD_BEND_RANGE_CENTS = 200;
const STANDARD_BEND_RANGE_SEMITONES = STANDARD_BEND_RANGE_CENTS / 100;
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
                // Reach the instrument voice through the one expression surface
                // the scheduled path also uses (audit MD-2).
                applyNoteExpression({
                    trackId: noteData.instrumentTrackId,
                    note: noteData.note,
                    channel: noteData.channel,
                    expression: {
                        pitchBend: noteData.pitchBend,
                        pressure: noteData.pressure,
                        slide: noteData.slide,
                    },
                });
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
                // A channel-wide bend is not MPE, but it reaches the instrument
                // through the same surface — applied to every sounding note at
                // the standard ±2 semitone range rather than the MPE member range.
                // It is deliberately *not* written back onto the note record:
                // only MPE member-channel bend is per-note data worth recording.
                applyNoteExpression({
                    trackId: noteData.instrumentTrackId,
                    note: noteData.note,
                    channel: noteData.channel,
                    expression: {
                        pitchBend: bendValue,
                        pressure: noteData.pressure,
                        slide: noteData.slide,
                    },
                    bendRangeSemitones: STANDARD_BEND_RANGE_SEMITONES,
                });
                if (noteData.osc) {
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, now, 0.003);
                }
            }
        }
);
