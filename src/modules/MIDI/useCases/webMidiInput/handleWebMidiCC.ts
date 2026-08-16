import { inject } from '#/infra/di/inject';
import { applyNoteExpression, audioEngine } from '#/modules/AudioEngine/useCases';

import { CC_ALL_NOTES_OFF, CC_ALL_SOUND_OFF, MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { MPE_SLIDE_CC } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { ingestChannelControlChange } from '../../repositories/webMidi/ingestChannelControlChange';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveDeviceNode } from './resolveDeviceNode';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime } from './resolveInputEventTime';

const CC_CHANNEL_VOLUME = 7;
const CC_PAN = 10;
const CC_SUSTAIN_PEDAL = 64;
const CC_SOSTENUTO_PEDAL = 66;
const CC_UNA_CORDA_PEDAL = 67;
const PEDAL_LATCH_THRESHOLD = 64;
const PAN_RANGE = 50;

export const handleWebMidiCC = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handleWebMidiCC(channel: number, cc: number, value: number, timeStamp?: number): void {
            const learnState = deps.getMidiLearnState();
            if (learnState?.isLearning && learnState.learningTarget) {
                deps.completeMidiLearn(channel, cc);
                return;
            }

            // Decode the byte against this channel's controller state before
            // anything acts on it: assemble 14-bit MSB/LSB pairs (audit MD-7)
            // and run the RPN state machine that owns pitch-bend sensitivity
            // (audit MD-8). A consumed message is a parameter-number select or
            // a Data Entry write; dispatching it as an ordinary CC as well
            // would let a controller declaring its bend range also move
            // whatever the user mapped to controller 6.
            const controlChange = ingestChannelControlChange({ channel, cc, value });
            if (controlChange.consumed) {
                return;
            }

            // All Sound Off / All Notes Off are channel-mode messages, not
            // controllers — a controller sends them to recover a note whose
            // note-off it knows it lost. They were parsed as ordinary CCs and
            // dropped, so the one recovery a keyboard offers did nothing
            // (audit MD-6). They never drive a mapped parameter.
            if (controlChange.cc === CC_ALL_SOUND_OFF || controlChange.cc === CC_ALL_NOTES_OFF) {
                // No outbound echo: the device that sent this already knows, and
                // a loopback port feeding our own input would panic forever.
                deps.panicLiveNotes({ notifyOutputs: false });
                return;
            }

            if (getMpeEnabled() && cc === MPE_SLIDE_CC && channel >= MPE_FIRST_MEMBER_CHANNEL) {
                const noteForChannel = channelToNote.get(channel);
                if (noteForChannel !== undefined) {
                    const noteData = activeNotes.get(noteForChannel);
                    if (noteData) {
                        noteData.slide = value;
                        // Reach the instrument voice through the one expression
                        // surface the scheduled path also uses (audit MD-2).
                        applyNoteExpression({
                            trackId: noteData.instrumentTrackId,
                            note: noteData.note,
                            channel: noteData.channel,
                            expression: {
                                pitchBend: noteData.pitchBend,
                                pressure: noteData.pressure,
                                slide: noteData.slide,
                            },
                            // Expression now shares the note events' serial
                            // tail (audit MD-3), so it can be voiced a turn or
                            // more after it arrived. Addressing its own arrival
                            // frame keeps it landing where it was performed.
                            sampleFrame: resolveInputDispatchFrame({
                                eventTime: resolveInputEventTime({ timeStamp }),
                            }),
                        });
                    }
                }
                return;
            }

            // Mappings and the built-in volume/pan controls address the
            // *resolved* controller (an LSB message reports its MSB's number)
            // and take the resolved position, so a 14-bit fader moves through
            // 16384 steps instead of 128.
            deps.applyMidiMappings(channel, controlChange.cc, controlChange.value, controlChange.normalized);

            const targetTrackId = getTargetTrackId();
            if (!targetTrackId) {
                return;
            }

            if (controlChange.cc === CC_CHANNEL_VOLUME) {
                audioEngine.setTrackGain(targetTrackId, controlChange.normalized);
            } else if (controlChange.cc === CC_PAN) {
                audioEngine.setTrackPan(targetTrackId, (controlChange.normalized * 2 - 1) * PAN_RANGE);
            }

            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((candidate) => candidate.id === targetTrackId);
            const grandBouleDevice = track?.devices.find((device) => device.type === 'grand-boule');
            if (grandBouleDevice) {
                const strip = audioEngine.getTrackStrip(targetTrackId);
                const deviceNode = resolveDeviceNode(strip, { deviceId: grandBouleDevice.id, type: 'grand-boule' });
                if (deviceNode?.grandBouleControls?.ready) {
                    // Pedals are 64/66/67 — above the 14-bit range, so the
                    // resolved controller and value are the raw ones.
                    if (controlChange.cc === CC_SUSTAIN_PEDAL) {
                        deviceNode.grandBouleControls.setSustain(controlChange.normalized);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: CC_SUSTAIN_PEDAL,
                            value: controlChange.normalized,
                        });
                    } else if (controlChange.cc === CC_SOSTENUTO_PEDAL) {
                        deviceNode.grandBouleControls.setSostenuto(controlChange.value >= PEDAL_LATCH_THRESHOLD);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: CC_SOSTENUTO_PEDAL,
                            value: controlChange.value >= PEDAL_LATCH_THRESHOLD,
                        });
                    } else if (controlChange.cc === CC_UNA_CORDA_PEDAL) {
                        deviceNode.grandBouleControls.setUnaCorda(controlChange.value >= PEDAL_LATCH_THRESHOLD);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: CC_UNA_CORDA_PEDAL,
                            value: controlChange.value >= PEDAL_LATCH_THRESHOLD,
                        });
                    }
                }
            }

            const levainDevice = track?.devices.find((device) => device.type === 'levain');
            if (levainDevice) {
                const strip = audioEngine.getTrackStrip(targetTrackId);
                const deviceNode = resolveDeviceNode(strip, { deviceId: levainDevice.id, type: 'levain' });
                if (deviceNode?.levainControls?.ready) {
                    // The raw wire bytes, deliberately: `handleCc` is the
                    // message boundary into the Levain worklet and its Rust
                    // engine reads a controller number and a 7-bit value.
                    deviceNode.levainControls.handleCc(cc, value);
                }
            }
        }
);
