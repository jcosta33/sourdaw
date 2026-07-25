import { inject } from '#/infra/di/inject';
import { applyNoteExpression, audioEngine } from '#/modules/AudioEngine/useCases';

import { MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveBendRangeSemitones } from './resolveBendRangeSemitones';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime } from './resolveInputEventTime';

const PITCH_BEND_CENTER = 8192;
const CENTS_PER_SEMITONE = 100;

export const handleWebMidiPitchBend = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handleWebMidiPitchBend(channel: number, lsb: number, msb: number, timeStamp?: number): void {
            // Expression now shares the note events' serial tail (audit MD-3),
            // so it can be voiced a turn or more after it arrived. Addressing
            // its own arrival frame keeps it landing where it was performed.
            const eventTime = resolveInputEventTime({ timeStamp });
            const dispatchFrame = resolveInputDispatchFrame({ eventTime });
            const dispatchTime = dispatchFrame / audioEngine.context.sampleRate;
            const bendValue = ((msb << 7) | lsb) - PITCH_BEND_CENTER;
            const mpeEnabled = getMpeEnabled();
            // The range used to be two hard-coded constants here (±2 and ±48),
            // restated a third time in cents for the fallback oscillator. It is
            // now resolved once from whatever the controller declared through
            // RPN 0 (audit MD-8), and that one number feeds both the engine
            // expression surface and the oscillator detune.
            const bendRangeSemitones = resolveBendRangeSemitones({ channel, mpeEnabled });
            const bendCents = (bendValue / PITCH_BEND_CENTER) * bendRangeSemitones * CENTS_PER_SEMITONE;
            const targetTrackId = getTargetTrackId();
            const baseDetune = targetTrackId ? deps.getSynthParamsForTrack(targetTrackId).detune : 0;

            if (mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL) {
                const noteForChannel = channelToNote.get(channel);
                if (noteForChannel === undefined) {
                    return;
                }
                const noteData = activeNotes.get(noteForChannel);
                if (!noteData) {
                    return;
                }
                noteData.pitchBend = bendValue;
                // The wire delta alone has no depth. Capture the range it was
                // performed against so recording can persist it and playback
                // can sound the bend the player heard (audit MD-8).
                noteData.pitchBendRangeSemitones = bendRangeSemitones;
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
                    bendRangeSemitones,
                    sampleFrame: dispatchFrame,
                });
                if (noteData.osc) {
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, dispatchTime, 0.003);
                }
                return;
            }

            for (const noteData of activeNotes.values()) {
                // A channel-wide bend is not MPE, but it reaches the instrument
                // through the same surface — applied to every sounding note at
                // the arriving channel's own range rather than the MPE member range.
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
                    bendRangeSemitones,
                    sampleFrame: dispatchFrame,
                });
                if (noteData.osc) {
                    noteData.osc.detune.setTargetAtTime(baseDetune + bendCents, dispatchTime, 0.003);
                }
            }
        }
);
