import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import {
    readBeatAtSamples,
    readSecondsAtBeat,
    tempoMapStore,
    transportStore,
    DEFAULT_TEMPO_BPM,
} from '#/modules/Transport/stores';
import { DEFAULT_NOTE_VELOCITY } from '#/utils/midiData';

import { createWebMidiNoteKey } from '../../models/WebMidiTypes';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { memberExpressionGeneration } from '../../repositories/webMidi/memberExpressionGeneration';
import { pendingYeastRelease } from '../../repositories/webMidi/pendingYeastRelease';
import { type RealtimeMidiEvent } from '../../repositories/webMidi/realtimeMidiProcessorState';
import { releaseActiveToasterNote } from '../../repositories/webMidi/releaseActiveToasterNote';
import { activeNotes, channelToNote } from '../../repositories/webMidi/state';

import { midiMessageHandlerDependencies } from './midiMessageHandlerDependencies';
import { resolveDeviceNode } from './resolveDeviceNode';
import { resolveInputDispatchFrame } from './resolveInputDispatchFrame';
import { resolveInputEventTime, type CapturedInputEventTime } from './resolveInputEventTime';
import { withRecordedNoteExpression } from './withRecordedNoteExpression';

/**
 * Length for a Yeast-generated note that reports no lifetime of its own. A
 * local copy of `handleWebMidiNoteOn`'s constant: that handler already imports
 * this one, so the reverse import would close a module cycle.
 */
const FALLBACK_GENERATED_NOTE_SECONDS = 0.5;

export const handleWebMidiNoteOff = inject(midiMessageHandlerDependencies)((deps) => {
    function findActiveRecordingClip(trackId: string, compensatedOnsetBeat: number): string | null {
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
            // Half-open [startBeat, endBeat), matching every other clip range
            // test in this module. An inclusive end makes the seam beat of two
            // abutting clips satisfy both, so `find` files the note into
            // whichever clip happens to come first in array order.
            const intersecting = midiClips.find(
                (clip) => compensatedOnsetBeat >= clip.startBeat && compensatedOnsetBeat < clip.endBeat
            );
            if (intersecting) {
                return intersecting.id;
            }

            if (
                transport.isLooping &&
                compensatedOnsetBeat >= transport.loopStart &&
                compensatedOnsetBeat <= transport.loopEnd
            ) {
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
        timeStamp?: number | CapturedInputEventTime
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
            const pendingRelease = pendingYeastRelease.begin(
                `${instrumentTrackId}:${yeastDevice.id}`,
                noteData.yeastVoiceReleases ?? new Map(),
                noteData.yeastGeneratedVoices ?? new Map(),
                instrumentTrackId,
                noteData.channel
            );
            // A reset while the release is being processed ended the input
            // session that owns its voices; batches drained from before it
            // must not voice into the new one (#4870).
            const generation = memberExpressionGeneration.current;
            // A drained event clamps to the delivery-time frame, the same
            // clamp the ingress batch applies against its post-processing
            // read (#4870).
            const drainedEventSampleFrame = (event: RealtimeMidiEvent): number =>
                Math.max(Math.round(context.currentTime * context.sampleRate), Math.round(event.timeSamples));
            const startCapturedVoice = (
                pitch: number,
                voiceChannel: number,
                generatedId: string | undefined,
                sampleFrame: number,
                start: () => void,
                release: (sampleFrame?: number, releaseVelocity?: number) => void
            ): void => {
                pendingYeastRelease.retire(`${instrumentTrackId}:${yeastDevice.id}`, voiceChannel, pitch, sampleFrame);
                if (generatedId === undefined) {
                    noteData.yeastVoiceReleases?.get(pitch)?.(sampleFrame, 0);
                    start();
                    (noteData.yeastVoiceReleases ??= new Map()).set(pitch, release);
                } else {
                    noteData.yeastGeneratedVoices?.get(generatedId)?.release(sampleFrame, 0);
                    start();
                    (noteData.yeastGeneratedVoices ??= new Map()).set(generatedId, {
                        pitch,
                        channel: voiceChannel,
                        release,
                    });
                }
            };
            // A generated note first emitted at the release block reaches its
            // block only through the idle pump; this is the same voicing path
            // the note-on handler gives its drained batches, over this
            // release's own route and ownership (#4870).
            const voiceYeastEvents = (drainedEvents: readonly RealtimeMidiEvent[]): void => {
                for (const event of drainedEvents) {
                    const eventSampleFrame = drainedEventSampleFrame(event);
                    if (event.kind.type === 'noteOn') {
                        const eventNote = event.kind.note;
                        const eventVelocity = event.kind.velocity;
                        const fermenterDevice = instrumentTrack.devices.find((device) => device.type === 'fermenter');
                        if (fermenterDevice) {
                            const deviceNode = resolveDeviceNode(audioEngine.getTrackStrip(instrumentTrackId), {
                                type: 'fermenter',
                            });
                            if (deviceNode?.fermenterControls) {
                                const control = deviceNode.fermenterControls;
                                startCapturedVoice(
                                    eventNote,
                                    event.kind.channel,
                                    event.noteInstanceId,
                                    eventSampleFrame,
                                    () =>
                                        control.noteOn(eventNote, eventVelocity, eventSampleFrame, event.kind.channel),
                                    (sampleFrame) => control.noteOff(eventNote, sampleFrame, event.kind.channel)
                                );
                            }
                            continue;
                        }
                        const grandBouleDevice = instrumentTrack.devices.find(
                            (device) => device.type === 'grand-boule'
                        );
                        if (grandBouleDevice) {
                            const deviceNode = resolveDeviceNode(audioEngine.getTrackStrip(instrumentTrackId), {
                                type: 'grand-boule',
                            });
                            if (deviceNode?.grandBouleControls) {
                                const control = deviceNode.grandBouleControls;
                                startCapturedVoice(
                                    eventNote,
                                    event.kind.channel,
                                    event.noteInstanceId,
                                    eventSampleFrame,
                                    () =>
                                        control.noteOn(
                                            eventNote,
                                            eventVelocity / 127,
                                            eventSampleFrame,
                                            event.kind.channel
                                        ),
                                    (sampleFrame, releaseVelocity) => {
                                        control.noteOff(eventNote, sampleFrame, releaseVelocity, event.kind.channel);
                                        void deps.eventBus.emit('midi.noteOff', {
                                            deviceId: grandBouleDevice.id,
                                            midiNote: eventNote,
                                            releaseVelocity,
                                        });
                                    }
                                );
                            }
                            void deps.eventBus.emit('midi.noteOn', {
                                deviceId: grandBouleDevice.id,
                                midiNote: eventNote,
                                velocity: eventVelocity / 127,
                            });
                            continue;
                        }
                        const levainDevice = instrumentTrack.devices.find((device) => device.type === 'levain');
                        if (levainDevice) {
                            const deviceNode = resolveDeviceNode(audioEngine.getTrackStrip(instrumentTrackId), {
                                type: 'levain',
                            });
                            if (deviceNode?.levainControls) {
                                const control = deviceNode.levainControls;
                                startCapturedVoice(
                                    eventNote,
                                    event.kind.channel,
                                    event.noteInstanceId,
                                    eventSampleFrame,
                                    () =>
                                        control.noteOn(eventNote, eventVelocity, eventSampleFrame, event.kind.channel),
                                    (sampleFrame) => control.noteOff(eventNote, sampleFrame, event.kind.channel)
                                );
                            }
                            continue;
                        }
                        // A generated note carries its own held lifetime; only
                        // a source event without one falls back to a fixed
                        // length (#4870).
                        let generatedDurationSeconds = FALLBACK_GENERATED_NOTE_SECONDS;
                        if (event.durationSamples !== undefined) {
                            generatedDurationSeconds = Math.max(0, event.durationSamples) / context.sampleRate;
                        }
                        const synthParams = deps.getSynthParamsForTrack(instrumentTrackId);
                        deps.scheduleNote(
                            context,
                            audioEngine.ensureTrackStrip(instrumentTrackId).gainNode,
                            eventNote,
                            eventSampleFrame / context.sampleRate,
                            generatedDurationSeconds,
                            eventVelocity,
                            synthParams
                        );
                    } else if (event.kind.type === 'noteOff') {
                        const eventNote = event.kind.note;
                        if (
                            pendingYeastRelease.releaseEvent({
                                routeId: `${instrumentTrackId}:${yeastDevice.id}`,
                                trackId: event.trackId,
                                noteInstanceId: event.noteInstanceId,
                                channel: event.kind.channel,
                                pitch: eventNote,
                                sampleFrame: eventSampleFrame,
                                releaseVelocity,
                            })
                        ) {
                            continue;
                        }
                        if (event.trackId !== undefined && event.trackId !== instrumentTrackId) {
                            continue;
                        }
                        if (event.noteInstanceId !== undefined) {
                            // A voice the drain itself created is absent from
                            // the pending snapshot taken before it existed; it
                            // releases through the live generated-voice map.
                            const voice = noteData.yeastGeneratedVoices?.get(event.noteInstanceId);
                            if (voice?.pitch === eventNote && voice.channel === event.kind.channel) {
                                voice.release(eventSampleFrame);
                                noteData.yeastGeneratedVoices?.delete(event.noteInstanceId);
                            }
                            continue;
                        }
                        if (
                            event.kind.channel !== noteData.channel ||
                            pendingYeastRelease.wasRetired(pendingRelease, eventNote)
                        ) {
                            continue;
                        }
                        pendingYeastRelease.release(pendingRelease, eventNote, eventSampleFrame, releaseVelocity);
                    }
                }
            };
            try {
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
                    onDrainedEvents: (drainedEvents) => {
                        // A reset ended the input session that owns this
                        // release's voices; the pump retires with it (#4870).
                        if (generation !== memberExpressionGeneration.current) {
                            return false;
                        }
                        voiceYeastEvents(drainedEvents);
                        return undefined;
                    },
                });
                // One voicing path for the ingress batch and every drained
                // idle-pump batch: a release-triggered tail's first generated
                // note rides this batch, and the source note's own release
                // still flows through the pending snapshot (#4870).
                voiceYeastEvents(processedEvents);
            } catch (error: unknown) {
                logger.warn('[MIDI] Yeast note release failed:', error);
                pendingYeastRelease.releaseAll(pendingRelease);
            } finally {
                pendingYeastRelease.finish(pendingRelease);
            }
        }

        if (noteData.nativeDeviceId) {
            void deps.sendNativeLiveMidiNote({
                trackId: instrumentTrackId,
                deviceId: noteData.nativeDeviceId,
                note,
                velocity: 0,
                channel: noteData.channel,
                isNoteOn: false,
            });
        }

        if (noteData.fermenterDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            // By instance id alone: a note-off has to release the very node its
            // note-on latched onto, so it must not fall back to the device kind.
            const deviceNode = resolveDeviceNode(strip, { deviceId: noteData.fermenterDeviceId });
            if (deviceNode?.fermenterControls) {
                deviceNode.fermenterControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        releaseActiveToasterNote(noteData, (trackId) => audioEngine.getTrackStrip(trackId));

        if (noteData.grandBouleDeviceId) {
            const strip = audioEngine.getTrackStrip(instrumentTrackId);
            const deviceNode = resolveDeviceNode(strip, { deviceId: noteData.grandBouleDeviceId });
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
            const deviceNode = resolveDeviceNode(strip, { deviceId: levainId });
            if (deviceNode?.levainControls) {
                deviceNode.levainControls.noteOff(note, dispatchFrame, noteData.channel);
            }
        }

        if (noteData.faustRelease) {
            // The closure is bound to the Faust device instance its note-on
            // started on, so the gate-off cannot drift to another device.
            noteData.faustRelease();
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
            const trackLatencySec = deps.getCompensationDelay(targetTrackId);
            const context = audioEngine.context;
            const totalLatencySec = (context.baseLatency || 0) + (context.outputLatency || 0) + trackLatencySec;

            // With a tempo map `transport.tempo` is inert (setTempo), so the
            // held length and the latency compensation convert through the
            // map's own placement reads — the same conversion audio recording
            // applies to a take (#3650, #4668). A flat timeline integrates as
            // the straight base-tempo line, where the closed form is exact.
            const tempoChanges = tempoMapStore.value?.changes ?? [];
            const defaultTempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
            const flatTimeline = tempoChanges.length === 0;
            const onsetSeconds = readSecondsAtBeat({ beat: noteData.startBeat });
            // The latency-rewound anchor: the timeline instant the musician
            // heard the onset at — the take conversion's `originSeconds`
            // (#3650). Start, end, and every expression offset integrate from
            // this one coordinate, so the recorded span equals the beats the
            // tempo map assigns the heard seconds (#4668).
            const originSeconds = onsetSeconds - totalLatencySec;
            let latencyAdjustedOnsetBeat = noteData.startBeat - (totalLatencySec * defaultTempo) / 60;
            if (!flatTimeline) {
                latencyAdjustedOnsetBeat = readBeatAtSamples({ samples: originSeconds, sampleRate: 1 });
            }

            // The note belongs to the clip holding its admitted onset: a
            // release processed after the playhead crossed a clip seam or a
            // loop wrap must not move it (#4869). Selection and storage share
            // the compensated coordinate: resolving on the raw onset would
            // file the note into the clip past the seam and clamp it to that
            // clip's origin — a heard 3.92 whose raw read is 4.02 (#4668).
            const clipId = findActiveRecordingClip(targetTrackId, latencyAdjustedOnsetBeat);
            if (!clipId) {
                return;
            }

            // noteData.startBeat is timeline-absolute (playhead at note-on);
            // the store is clip-relative, so subtract the recording clip's
            // media origin or notes land clip.startBeat late (M-143).
            const recordingClip = track?.clips.find((candidate) => candidate.id === clipId);
            const clipMediaOrigin = recordingClip ? recordingClip.startBeat - (recordingClip.midiOffsetBeats ?? 0) : 0;

            const compensatedStartBeat = Math.max(0, latencyAdjustedOnsetBeat - clipMediaOrigin);

            // The end is read at the heard seconds from the SAME rewound
            // origin the start was placed with — the take conversion's
            // `originSeconds + buffer.duration` (#3650). Integrating from the
            // raw onset misplaces the end of a hold across a tempo change by
            // `latency × Δtempo`. The flat timeline keeps its closed form,
            // which already composes: start − L·t/60 … start + (D−L)·t/60.
            const durationSeconds = eventTime - noteData.startTime;
            let durationBeats = (durationSeconds * defaultTempo) / 60;
            if (!flatTimeline) {
                durationBeats =
                    readBeatAtSamples({ samples: originSeconds + durationSeconds, sampleRate: 1 }) -
                    latencyAdjustedOnsetBeat;
            }

            // Expression offsets share the compensated origin, so a curve
            // point lands on the beat its own heard instant maps to.
            const secondsToBeats = (seconds: number): number => {
                if (flatTimeline) {
                    return (seconds * defaultTempo) / 60;
                }
                return (
                    readBeatAtSamples({ samples: originSeconds + seconds, sampleRate: 1 }) - latencyAdjustedOnsetBeat
                );
            };

            // Preserve the played velocity (was hardcoded 100, M-143).
            const midiNote = deps.createMidiNote(
                note,
                compensatedStartBeat,
                Math.max(durationBeats, 0.0625),
                noteData.velocity ?? DEFAULT_NOTE_VELOCITY
            );

            if (!getMpeEnabled()) {
                deps.appendRecordedMidiNote({ clipId, note: midiNote });
                return;
            }
            const recordedNote = withRecordedNoteExpression(midiNote, noteData, secondsToBeats);
            deps.appendRecordedMidiNote({ clipId, note: recordedNote });
        }
    };
});
