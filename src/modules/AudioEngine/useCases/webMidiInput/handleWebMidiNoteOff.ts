import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { routeYeastNoteOffToInstrument } from '../../repositories/webMidi/routeYeastNoteOffToInstrument';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';

function secondsToBeats(seconds: number, tempo: number): number {
    return (seconds * tempo) / 60;
}

export const handleWebMidiNoteOff = inject(midiMessageHandlerDependencies)((deps) => {
    function findActiveRecordingClip(trackId: string): string | null {
        const trackState = deps.getTrackStoreState();
        const transport = deps.getTransportStoreValue();
        if (!trackState || !transport) {
            return null;
        }

        const track = trackState.tracks.find((candidate) => candidate.id === trackId);
        if (!track) {
            return null;
        }

        const midiClips = track.clips.filter((clip) => clip.type === 'midi');
        if (midiClips.length === 0) {
            return null;
        }

        if (transport.isRecording && transport.overdubEnabled) {
            const playhead = deps.playheadPositionRef.current;
            const intersecting = midiClips.find((clip) => playhead >= clip.startBeat && playhead <= clip.endBeat);
            if (intersecting) {
                return intersecting.id;
            }

            if (transport.isLooping && playhead >= transport.loopStart && playhead <= transport.loopEnd) {
                const loopClip = midiClips.find(
                    (clip) => clip.startBeat >= transport.loopStart && clip.endBeat <= transport.loopEnd
                );
                if (loopClip) {
                    return loopClip.id;
                }
            }
        }

        return midiClips[midiClips.length - 1]!.id;
    }

    return function handleWebMidiNoteOff(channel: number, note: number, releaseVelocity: number = 0): void {
        deps.stepRecordNoteOff(note);
        const noteData = activeNotes.get(note);
        if (!noteData) {
            return;
        }

        activeNotes.delete(note);

        if (getMpeEnabled()) {
            channelToNote.delete(noteData.channel);
        }

        const targetTrackId = getTargetTrackId();
        if (targetTrackId) {
            const trackState = deps.getTrackStoreState();
            const targetTrack = trackState?.tracks.find((candidate) => candidate.id === targetTrackId);

            let instrumentTrack = targetTrack;
            if (targetTrack && targetTrack.parentId && trackState) {
                const parent = trackState.tracks.find((candidate) => candidate.id === targetTrack.parentId);
                if (parent?.devices.some((device) => device.type === 'toaster')) {
                    instrumentTrack = parent;
                }
            }

            if (instrumentTrack?.devices.some((device) => device.type === 'yeast')) {
                const context = audioEngine.context;
                const sampleTime = Math.round(context.currentTime * context.sampleRate);
                const processedEvents = deps.processRealtimeMidiInput(
                    note,
                    0,
                    channel,
                    false,
                    sampleTime,
                    context.sampleRate
                );
                const strip = audioEngine.getTrackStrip(instrumentTrack.id);
                const emitGrandBouleOff = (deviceId: string, midiNote: number): void => {
                    void deps.eventBus.emit('midi.noteOff', { deviceId, midiNote, releaseVelocity });
                };
                for (const event of processedEvents) {
                    if (event.kind.type !== 'noteOff') {
                        continue;
                    }
                    routeYeastNoteOffToInstrument(
                        instrumentTrack,
                        strip,
                        event.kind.note,
                        releaseVelocity,
                        emitGrandBouleOff
                    );
                }
            }
        }

        if (noteData.fermenterDeviceId && targetTrackId) {
            const strip = audioEngine.getTrackStrip(targetTrackId);
            const deviceNode = strip?.deviceNodes.find(
                (candidate) => candidate.deviceId === noteData.fermenterDeviceId
            );
            if (deviceNode?.fermenterControls) {
                deviceNode.fermenterControls.noteOff(note);
            }
        }

        if (noteData.toasterDeviceId && targetTrackId) {
            const trackState = deps.getTrackStoreState();
            const track = trackState?.tracks.find((candidate) => candidate.id === targetTrackId);
            let instrumentTrackId = targetTrackId;
            let toasterChildPad: number | null = null;

            if (track && track.devices.length === 0 && track.parentId && trackState) {
                let parent: typeof track | undefined;
                let padIndex = 0;
                for (const candidate of trackState.tracks) {
                    if (candidate.id === track.parentId) {
                        parent = candidate;
                    } else if (candidate.parentId === track.parentId) {
                        if (candidate.id === track.id) {
                            toasterChildPad = padIndex;
                        }
                        padIndex++;
                    }
                }
                if (parent?.devices.some((device) => device.type === 'toaster')) {
                    instrumentTrackId = parent.id;
                } else {
                    toasterChildPad = null;
                }
            }

            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = strip?.deviceNodes.find((candidate) => candidate.deviceId === noteData.toasterDeviceId);
            if (deviceNode?.toasterControls) {
                let pad = toasterChildPad;
                if (pad === null || pad === -1) {
                    pad = note - 36;
                    if (pad >= 24 && pad <= 39) {
                        pad = pad - 24;
                    }
                }
                if (pad >= 0 && pad < 16) {
                    deviceNode.toasterControls.noteOff(pad);
                }
            }
        }

        if (noteData.grandBouleDeviceId && targetTrackId) {
            const strip = audioEngine.getTrackStrip(targetTrackId);
            const deviceNode = strip?.deviceNodes.find(
                (candidate) => candidate.deviceId === noteData.grandBouleDeviceId
            );
            if (deviceNode?.grandBouleControls) {
                deviceNode.grandBouleControls.noteOff(note, undefined, releaseVelocity);
            }
            void deps.eventBus.emit('midi.noteOff', {
                deviceId: noteData.grandBouleDeviceId,
                midiNote: note,
                releaseVelocity,
            });
        }

        if (noteData.levainDeviceId && targetTrackId) {
            const strip = audioEngine.getTrackStrip(targetTrackId);
            const levainId = noteData.levainDeviceId;
            const deviceNode = strip?.deviceNodes.find((candidate) => candidate.deviceId === levainId);
            if (deviceNode?.levainControls) {
                deviceNode.levainControls.noteOff(note);
            }
        }

        if (noteData.osc) {
            const now = audioEngine.context.currentTime;
            const synthParams = targetTrackId ? deps.getSynthParamsForTrack(targetTrackId) : null;
            const releaseTime = synthParams?.release ?? 0.3;
            if (noteData.osc._env) {
                noteData.osc._env.gain.cancelScheduledValues(now);
                noteData.osc._env.gain.setTargetAtTime(0, now, releaseTime / 3);
            }
            try {
                noteData.osc.stop(now + releaseTime + 0.05);
            } catch {
                // Already stopped.
            }
        }

        if (!targetTrackId) {
            return;
        }

        const transport = deps.getTransportStoreValue();
        const trackState = deps.getTrackStoreState();
        const track = trackState?.tracks.find((candidate) => candidate.id === targetTrackId);
        const isArmed = track?.armed ?? false;
        const isRecording = transport?.isRecording ?? false;

        if (isRecording && isArmed) {
            const clipId = findActiveRecordingClip(targetTrackId);
            if (!clipId) {
                return;
            }

            const tempo = transport?.tempo ?? 120;
            const durationSeconds = audioEngine.context.currentTime - noteData.startTime;
            const durationBeats = secondsToBeats(durationSeconds, tempo);

            const trackLatencySec = deps.getCompensationDelay(targetTrackId);
            const context = audioEngine.context;
            const totalLatencySec = (context.baseLatency || 0) + (context.outputLatency || 0) + trackLatencySec;
            const offsetBeats = secondsToBeats(totalLatencySec, tempo);
            const compensatedStartBeat = Math.max(0, noteData.startBeat - offsetBeats);

            const midiNote = deps.createMidiNote(note, compensatedStartBeat, Math.max(durationBeats, 0.0625), 100);

            if (getMpeEnabled()) {
                if (noteData.pressure !== undefined) {
                    midiNote.pressure = noteData.pressure;
                }
                if (noteData.slide !== undefined) {
                    midiNote.slide = noteData.slide;
                }
                if (noteData.pitchBend !== undefined) {
                    midiNote.pitchBend = noteData.pitchBend;
                }
            }

            deps.appendRecordedMidiNote({ clipId, note: midiNote });
        }
    };
});
