import { inject } from '#/infra/di/inject';
import { audioEngine } from '#/modules/AudioEngine/useCases';

import { createWebMidiNoteKey } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { releaseActiveToasterNote } from '../../repositories/webMidi/releaseActiveToasterNote';
import { routeYeastNoteOffToInstrument } from '../../repositories/webMidi/routeYeastNoteOffToInstrument';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime } from './resolveInputEventTime';

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
            // Half-open [startBeat, endBeat), matching every other clip range
            // test in this module. An inclusive end makes the seam beat of two
            // abutting clips satisfy both, so `find` files the note into
            // whichever clip happens to come first in array order.
            const intersecting = midiClips.find((clip) => playhead >= clip.startBeat && playhead < clip.endBeat);
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

    return async function handleWebMidiNoteOff(
        channel: number,
        note: number,
        releaseVelocity: number = 0,
        timeStamp?: number
    ): Promise<void> {
        // When the key was released, not when this handler got its turn. The
        // recorded note length is the difference between two of these, so both
        // ends have to be measured on the same footing (audit MD-1).
        const eventTime = resolveInputEventTime({ timeStamp });
        const dispatchFrame = resolveInputDispatchFrame({ eventTime });
        deps.stepRecordNoteOff(note);
        const noteKey = createWebMidiNoteKey(channel, note);
        const noteData = activeNotes.get(noteKey);
        if (!noteData) {
            return;
        }

        activeNotes.delete(noteKey);

        if (channelToNote.get(noteData.channel) === noteKey) {
            channelToNote.delete(noteData.channel);
        }

        const targetTrackId = noteData.trackId;
        const instrumentTrackId = noteData.instrumentTrackId;
        const instrumentTrackState = deps.getTrackStoreState();
        const instrumentTrack = instrumentTrackState?.tracks.find((candidate) => candidate.id === instrumentTrackId);

        const yeastDevice = instrumentTrack?.devices.find((device) => device.type === 'yeast');
        if (instrumentTrack && yeastDevice) {
            const context = audioEngine.context;
            const sampleTime = dispatchFrame;
            const processedEvents = await deps.processRealtimeMidiInput({
                context,
                rackId: yeastDevice.id,
                routeId: instrumentTrack.id,
                trackId: instrumentTrack.id,
                note,
                velocity: 0,
                channel,
                isNoteOn: false,
                sampleTime,
                sampleRate: context.sampleRate,
                noteInstanceId: noteData.noteInstanceId,
            });
            const strip = audioEngine.getTrackStrip(instrumentTrack.id);
            function emitGrandBouleOff(deviceId: string, midiNote: number): void {
                void deps.eventBus.emit('midi.noteOff', { deviceId, midiNote, releaseVelocity });
            }
            const earliestDispatchFrame = Math.round(context.currentTime * context.sampleRate);
            for (const event of processedEvents) {
                if (event.kind.type !== 'noteOff') {
                    continue;
                }
                routeYeastNoteOffToInstrument(
                    instrumentTrack,
                    strip,
                    event.kind.note,
                    releaseVelocity,
                    emitGrandBouleOff,
                    Math.max(earliestDispatchFrame, Math.round(event.timeSamples))
                );
            }
        }

        if (noteData.fermenterDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = strip?.deviceNodes.find(
                (candidate) => candidate.deviceId === noteData.fermenterDeviceId
            );
            if (deviceNode?.fermenterControls) {
                deviceNode.fermenterControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        releaseActiveToasterNote(noteData, (trackId) => audioEngine.getTrackStrip(trackId));

        if (noteData.grandBouleDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = strip?.deviceNodes.find(
                (candidate) => candidate.deviceId === noteData.grandBouleDeviceId
            );
            if (deviceNode?.grandBouleControls) {
                deviceNode.grandBouleControls.noteOff(note, dispatchFrame, releaseVelocity, noteData.channel);
            }
            void deps.eventBus.emit('midi.noteOff', {
                deviceId: noteData.grandBouleDeviceId,
                midiNote: note,
                releaseVelocity,
            });
        }

        if (noteData.levainDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const levainId = noteData.levainDeviceId;
            const deviceNode = strip?.deviceNodes.find((candidate) => candidate.deviceId === levainId);
            if (deviceNode?.levainControls) {
                deviceNode.levainControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        if (noteData.osc) {
            const now = dispatchFrame / audioEngine.context.sampleRate;
            const synthParams = deps.getSynthParamsForTrack(targetTrackId);
            const releaseTime = synthParams.release;
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
            const durationSeconds = eventTime - noteData.startTime;
            const durationBeats = secondsToBeats(durationSeconds, tempo);

            const trackLatencySec = deps.getCompensationDelay(targetTrackId);
            const context = audioEngine.context;
            const totalLatencySec = (context.baseLatency || 0) + (context.outputLatency || 0) + trackLatencySec;
            const offsetBeats = secondsToBeats(totalLatencySec, tempo);
            // noteData.startBeat is timeline-absolute (playhead at note-on);
            // the store is clip-relative, so subtract the recording clip's
            // media origin or notes land clip.startBeat late (M-143).
            const recordingClip = track?.clips.find((candidate) => candidate.id === clipId);
            const clipMediaOrigin = recordingClip ? recordingClip.startBeat - (recordingClip.midiOffsetBeats ?? 0) : 0;
            const compensatedStartBeat = Math.max(0, noteData.startBeat - offsetBeats - clipMediaOrigin);

            // Preserve the played velocity (was hardcoded 100, M-143).
            const midiNote = deps.createMidiNote(
                note,
                compensatedStartBeat,
                Math.max(durationBeats, 0.0625),
                noteData.velocity ?? 100
            );

            if (getMpeEnabled()) {
                if (noteData.pressure !== undefined) {
                    midiNote.pressure = noteData.pressure;
                }
                if (noteData.slide !== undefined) {
                    midiNote.slide = noteData.slide;
                }
                if (noteData.pitchBend !== undefined) {
                    midiNote.pitchBend = noteData.pitchBend;
                    // Persist the depth alongside the wire delta. Without it
                    // playback re-interprets every recorded bend at the MPE
                    // default, so a controller set to ±12 records +6 semitones
                    // and plays back +24 (audit MD-8).
                    midiNote.pitchBendRangeSemitones = noteData.pitchBendRangeSemitones;
                }
            }

            deps.appendRecordedMidiNote({ clipId, note: midiNote });
        }
    };
});
