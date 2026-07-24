import { inject } from '#/infra/di/inject';
import { applyNoteExpression, audioEngine } from '#/modules/AudioEngine/useCases';

import { MPE_SLIDE_CC } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

export const handleWebMidiCC = inject(midiMessageHandlerDependencies)(
    (deps) =>
        function handleWebMidiCC(channel: number, cc: number, value: number): void {
            const learnState = deps.getMidiLearnState();
            if (learnState?.isLearning && learnState.learningTarget) {
                deps.completeMidiLearn(channel, cc);
                return;
            }

            if (getMpeEnabled() && cc === MPE_SLIDE_CC && channel >= 1) {
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
                            expression: {
                                pitchBend: noteData.pitchBend,
                                pressure: noteData.pressure,
                                slide: noteData.slide,
                            },
                        });
                    }
                }
                return;
            }

            deps.applyMidiMappings(channel, cc, value);

            const targetTrackId = getTargetTrackId();
            if (!targetTrackId) {
                return;
            }

            if (cc === 7) {
                audioEngine.setTrackGain(targetTrackId, value / 127);
            } else if (cc === 10) {
                audioEngine.setTrackPan(targetTrackId, ((value / 127) * 2 - 1) * 50);
            }

            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((candidate) => candidate.id === targetTrackId);
            const grandBouleDevice = track?.devices.find((device) => device.type === 'grand-boule');
            if (grandBouleDevice) {
                const strip = audioEngine.getTrackStrip(targetTrackId);
                const deviceNode = strip?.deviceNodes.find(
                    (candidate) => candidate.deviceId === grandBouleDevice.id || candidate.type === 'grand-boule'
                );
                if (deviceNode?.grandBouleControls?.ready) {
                    if (cc === 64) {
                        deviceNode.grandBouleControls.setSustain(value / 127);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 64,
                            value: value / 127,
                        });
                    } else if (cc === 66) {
                        deviceNode.grandBouleControls.setSostenuto(value >= 64);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 66,
                            value: value >= 64,
                        });
                    } else if (cc === 67) {
                        deviceNode.grandBouleControls.setUnaCorda(value >= 64);
                        void deps.eventBus.emit('midi.pedalCc', {
                            deviceId: grandBouleDevice.id,
                            cc: 67,
                            value: value >= 64,
                        });
                    }
                }
            }

            const levainDevice = track?.devices.find((device) => device.type === 'levain');
            if (levainDevice) {
                const strip = audioEngine.getTrackStrip(targetTrackId);
                const deviceNode = strip?.deviceNodes.find(
                    (candidate) => candidate.deviceId === levainDevice.id || candidate.type === 'levain'
                );
                if (deviceNode?.levainControls?.ready) {
                    deviceNode.levainControls.handleCc(cc, value);
                }
            }
        }
);
