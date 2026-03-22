import { getTrackStoreState, getMidiStoreState, getAutomationLanes } from '#/modules/Track/useCases/trackQueries';
import { getTransportStoreValue, getTempoMapState } from '#/modules/Transport/useCases/transportQueries';
import { audioBufferCache } from '../stores/audioBufferCache';
import { buildDeviceChain } from './buildDeviceChain';
import { scheduleNote, getSynthParamsForTrack } from './builtinSynth';
import { scheduleKitNote } from './drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from './drumSynthEngine';
import { resolveClipsWithComping } from '#/modules/Track/useCases/resolveComping';
import { beatToSeconds, resolveDrumKit, scheduleTrackAutomation } from '../repositories/offlineScheduler';

// Re-export encoders for consumers
export { audioBufferToWav, downloadWav, downloadMp3, downloadFlac } from '../repositories/audioEncoders';

const MICRO_FADE_SECONDS = 0.003;

export async function renderOffline(durationBeats: number, sampleRate = 44100): Promise<AudioBuffer> {
    const transport = getTransportStoreValue();
    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(offlineCtx.destination);

    const automationLanes = getAutomationLanes();

    if (tracks && midi) {
        for (const track of tracks.tracks) {
            if (track.muted || track.kind === 'folder') {
                continue;
            }

            const trackGain = offlineCtx.createGain();
            trackGain.gain.value = track.gain;

            const trackPan = offlineCtx.createStereoPanner();
            trackPan.pan.value = track.pan / 50;

            if (track.frozen && track.frozenBufferId) {
                trackGain.connect(trackPan);
                trackPan.connect(masterGain);

                const frozenBuf = audioBufferCache.get(track.frozenBufferId);
                if (frozenBuf) {
                    const source = offlineCtx.createBufferSource();
                    source.buffer = frozenBuf;
                    source.connect(trackGain);
                    source.start(0);
                }
                continue;
            }

            const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
            trackPan.connect(masterGain);

            scheduleTrackAutomation(
                automationLanes,
                track.id,
                trackGain,
                trackPan,
                deviceEntries,
                durationSeconds,
                defaultTempo,
                changes
            );

            const resolvedClips = resolveClipsWithComping(track.id, track.clips);

            for (const clip of resolvedClips) {
                const clipVisualLength = clip.endBeat - clip.startBeat;
                const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
                const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

                if (clip.type === 'midi') {
                    const notes = midi.notesByClipId[clip.id];
                    if (!notes) {
                        continue;
                    }

                    const drumKit = resolveDrumKit(track.devices);
                    const kitDef = getDrumKitDefByIndex(
                        track.devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit')?.parameterValues.kit ?? 0
                    );
                    const synthParams = (drumKit || kitDef) ? null : getSynthParamsForTrack(track.id);

                    for (let iter = 0; iter < maxIterations; iter++) {
                        const iterOffset = iter * loopLen;

                        for (const note of notes) {
                            if (note.startBeat >= loopLen) {
                                continue;
                            }
                            if (note.startBeat + note.duration <= 0) {
                                continue;
                            }

                            const noteAbsStart = clip.startBeat + iterOffset + note.startBeat;
                            if (noteAbsStart >= clip.endBeat) {
                                continue;
                            }

                            const startTime = beatToSeconds(noteAbsStart, defaultTempo, changes);
                            const noteEndBeat = Math.min(noteAbsStart + note.duration, clip.endBeat);
                            const endTime = beatToSeconds(noteEndBeat, defaultTempo, changes);
                            const duration = endTime - startTime;
                            if (startTime >= durationSeconds || duration <= 0) {
                                continue;
                            }

                            if (kitDef) {
                                scheduleDrumKitNote(
                                    offlineCtx,
                                    trackGain,
                                    kitDef,
                                    note.pitch,
                                    startTime,
                                    note.velocity
                                );
                            } else if (drumKit) {
                                scheduleKitNote(
                                    offlineCtx,
                                    trackGain,
                                    drumKit,
                                    note.pitch,
                                    startTime,
                                    duration,
                                    note.velocity
                                );
                            } else {
                                scheduleNote(
                                    offlineCtx,
                                    trackGain,
                                    note.pitch,
                                    startTime,
                                    duration,
                                    note.velocity,
                                    synthParams!
                                );
                            }
                        }
                    }
                } else if (clip.type === 'audio' && clip.audioBufferId) {
                    const buffer = audioBufferCache.get(clip.audioBufferId);
                    if (!buffer) {
                        continue;
                    }

                    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;

                    for (let iter = 0; iter < maxIterations; iter++) {
                        const iterStartBeat = clip.startBeat + iter * loopLen;
                        if (iterStartBeat >= clip.endBeat) {
                            break;
                        }

                        const iterStartTime = beatToSeconds(iterStartBeat, defaultTempo, changes);
                        if (iterStartTime >= durationSeconds) {
                            break;
                        }

                        const isFirstIter = iter === 0;
                        const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
                        const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                        const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;

                        const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                        const iterEndTime = beatToSeconds(iterStartBeat + remainingBeats, defaultTempo, changes);
                        const iterDurationSec = iterEndTime - iterStartTime;
                        const playDuration = Math.min(iterDurationSec, buffer.duration / stretchRatio);

                        const source = offlineCtx.createBufferSource();
                        source.buffer = buffer;
                        if (stretchRatio !== 1) {
                            source.playbackRate.value = stretchRatio;
                        }

                        const startSec = Math.max(0, iterStartTime);

                        if (needsMicroFadeIn || needsMicroFadeOut) {
                            const fadeGain = offlineCtx.createGain();
                            source.connect(fadeGain);
                            fadeGain.connect(trackGain);

                            if (needsMicroFadeIn) {
                                fadeGain.gain.setValueAtTime(0, startSec);
                                fadeGain.gain.linearRampToValueAtTime(1, startSec + MICRO_FADE_SECONDS);
                            } else {
                                fadeGain.gain.setValueAtTime(1, startSec);
                            }

                            if (needsMicroFadeOut) {
                                const endSec = startSec + playDuration;
                                fadeGain.gain.setValueAtTime(1, Math.max(startSec, endSec - MICRO_FADE_SECONDS));
                                fadeGain.gain.linearRampToValueAtTime(0, endSec);
                            }
                        } else {
                            source.connect(trackGain);
                        }

                        source.start(startSec, 0, playDuration * stretchRatio);
                    }
                }
            }
        }
    }

    return offlineCtx.startRendering();
}

export async function exportStems(durationBeats: number, sampleRate = 44100): Promise<Map<string, AudioBuffer>> {
    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const transport = getTransportStoreValue();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);
    const stems = new Map<string, AudioBuffer>();

    if (!tracks || !midi) {
        return stems;
    }

    const stemsAutomationLanes = getAutomationLanes();

    for (const track of tracks.tracks) {
        if (track.kind === 'folder' || track.kind === 'master') {
            continue;
        }

        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;

        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;

        if (track.frozen && track.frozenBufferId) {
            trackGain.connect(trackPan);
            trackPan.connect(offlineCtx.destination);

            const frozenBuf = audioBufferCache.get(track.frozenBufferId);
            if (frozenBuf) {
                const source = offlineCtx.createBufferSource();
                source.buffer = frozenBuf;
                source.connect(trackGain);
                source.start(0);
            }

            const buffer = await offlineCtx.startRendering();
            stems.set(track.id, buffer);
            continue;
        }

        const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        scheduleTrackAutomation(
            stemsAutomationLanes,
            track.id,
            trackGain,
            trackPan,
            deviceEntries,
            durationSeconds,
            defaultTempo,
            changes
        );

        const resolvedClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedClips) {
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

            if (clip.type === 'midi') {
                const notes = midi.notesByClipId[clip.id];
                if (!notes) {
                    continue;
                }

                const drumKit = resolveDrumKit(track.devices);
                const kitDef = getDrumKitDefByIndex(
                    track.devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit')?.parameterValues.kit ?? 0
                );
                const synthParams = (drumKit || kitDef) ? null : getSynthParamsForTrack(track.id);

                for (let iter = 0; iter < maxIterations; iter++) {
                    const iterOffset = iter * loopLen;

                    for (const note of notes) {
                        if (note.startBeat >= loopLen) {
                            continue;
                        }

                        const noteAbsStart = clip.startBeat + iterOffset + note.startBeat;
                        if (noteAbsStart >= clip.endBeat) {
                            continue;
                        }

                        const startTime = beatToSeconds(noteAbsStart, defaultTempo, changes);
                        const noteEndBeat = Math.min(noteAbsStart + note.duration, clip.endBeat);
                        const endTime = beatToSeconds(noteEndBeat, defaultTempo, changes);
                        const duration = endTime - startTime;
                        if (startTime >= durationSeconds || duration <= 0) {
                            continue;
                        }

                        if (kitDef) {
                            scheduleDrumKitNote(
                                offlineCtx,
                                trackGain,
                                kitDef,
                                note.pitch,
                                startTime,
                                note.velocity
                            );
                        } else if (drumKit) {
                            scheduleKitNote(
                                offlineCtx,
                                trackGain,
                                drumKit,
                                note.pitch,
                                startTime,
                                duration,
                                note.velocity
                            );
                        } else {
                            scheduleNote(
                                offlineCtx,
                                trackGain,
                                note.pitch,
                                startTime,
                                duration,
                                note.velocity,
                                synthParams!
                            );
                        }
                    }
                }
            } else if (clip.type === 'audio' && clip.audioBufferId) {
                const audioBuf = audioBufferCache.get(clip.audioBufferId);
                if (!audioBuf) {
                    continue;
                }

                const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;

                for (let iter = 0; iter < maxIterations; iter++) {
                    const iterStartBeat = clip.startBeat + iter * loopLen;
                    if (iterStartBeat >= clip.endBeat) {
                        break;
                    }

                    const iterStartTime = beatToSeconds(iterStartBeat, defaultTempo, changes);
                    if (iterStartTime >= durationSeconds) {
                        break;
                    }

                    const isFirstIter = iter === 0;
                    const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
                    const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                    const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;

                    const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                    const iterEndTime = beatToSeconds(iterStartBeat + remainingBeats, defaultTempo, changes);
                    const iterDurationSec = iterEndTime - iterStartTime;
                    const playDuration = Math.min(iterDurationSec, audioBuf.duration / stretchRatio);

                    const source = offlineCtx.createBufferSource();
                    source.buffer = audioBuf;
                    if (stretchRatio !== 1) {
                        source.playbackRate.value = stretchRatio;
                    }

                    const startSec = Math.max(0, iterStartTime);

                    if (needsMicroFadeIn || needsMicroFadeOut) {
                        const fadeGain = offlineCtx.createGain();
                        source.connect(fadeGain);
                        fadeGain.connect(trackGain);

                        if (needsMicroFadeIn) {
                            fadeGain.gain.setValueAtTime(0, startSec);
                            fadeGain.gain.linearRampToValueAtTime(1, startSec + MICRO_FADE_SECONDS);
                        } else {
                            fadeGain.gain.setValueAtTime(1, startSec);
                        }

                        if (needsMicroFadeOut) {
                            const endSec = startSec + playDuration;
                            fadeGain.gain.setValueAtTime(1, Math.max(startSec, endSec - MICRO_FADE_SECONDS));
                            fadeGain.gain.linearRampToValueAtTime(0, endSec);
                        }
                    } else {
                        source.connect(trackGain);
                    }

                    source.start(startSec, 0, playDuration * stretchRatio);
                }
            }
        }

        const buffer = await offlineCtx.startRendering();
        stems.set(track.id, buffer);
    }

    return stems;
}
