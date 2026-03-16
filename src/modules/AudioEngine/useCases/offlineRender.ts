import { trackStore } from "#/modules/Track/stores/trackStore";
import { midiStore } from "#/modules/Track/stores/midiStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { tempoMapStore } from "#/modules/Transport/stores/tempoMapStore";
import { getTempoAtBeat, type TempoChange } from "#/modules/Transport/models/TempoMap";
import { automationStore } from "#/modules/Track/stores/automationStore";
import type { AutomationLane, AutomationPoint } from "#/modules/Track/models/Automation";
import { audioBufferCache } from "../stores/audioBufferCache";
import { buildDeviceChain, type DeviceNodeEntry, type OfflineDeviceNode } from "./buildDeviceChain";
import { scheduleNote, getSynthParamsForTrack } from "./builtinSynth";
import { getDrumKitByIndex, scheduleKitNote } from "./drumKitSynth";
import type { DrumKit } from "./drumKitSynth";
import { resolveClipsWithComping } from "#/modules/Track/useCases/resolveComping";

const MICRO_FADE_SECONDS = 0.003;

const beatToSeconds = (beat: number, defaultTempo: number, changes: TempoChange[]): number => {
    if (changes.length === 0) return (beat / defaultTempo) * 60;

    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    let seconds = 0;
    let prevBeat = 0;
    let prevTempo = sorted[0]!.beat > 0 ? defaultTempo : sorted[0]!.tempo;

    for (const change of sorted) {
        if (change.beat >= beat) break;
        const segment = change.beat - prevBeat;
        seconds += (segment / prevTempo) * 60;
        prevBeat = change.beat;
        prevTempo = change.tempo;
    }

    seconds += ((beat - prevBeat) / getTempoAtBeat(sorted, beat, prevTempo)) * 60;
    return seconds;
};

const resolveDrumKit = (devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null => {
    const kitDevice = devices.find((d) => d.type === "drum-kit");
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues["kitId"] ?? 0;
    return getDrumKitByIndex(kitIndex);
};

const resolveDeviceParam = (
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode,
): AudioParam | null => {
    const paramMap: Record<string, () => AudioParam | null> = {
        "builtin-eq:eq-low-gain": () => (node.nodes[0] as BiquadFilterNode | undefined)?.gain ?? null,
        "builtin-eq:eq-low-freq": () => (node.nodes[0] as BiquadFilterNode | undefined)?.frequency ?? null,
        "builtin-eq:eq-mid-gain": () => (node.nodes[1] as BiquadFilterNode | undefined)?.gain ?? null,
        "builtin-eq:eq-mid-freq": () => (node.nodes[1] as BiquadFilterNode | undefined)?.frequency ?? null,
        "builtin-eq:eq-mid-q": () => (node.nodes[1] as BiquadFilterNode | undefined)?.Q ?? null,
        "builtin-eq:eq-high-gain": () => (node.nodes[2] as BiquadFilterNode | undefined)?.gain ?? null,
        "builtin-eq:eq-high-freq": () => (node.nodes[2] as BiquadFilterNode | undefined)?.frequency ?? null,
        "builtin-compressor:comp-threshold": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        "builtin-compressor:comp-ratio": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.ratio ?? null,
        "builtin-compressor:comp-attack": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.attack ?? null,
        "builtin-compressor:comp-release": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        "builtin-compressor:comp-makeup": () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
        "builtin-reverb:rev-mix": () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        "builtin-delay:delay-time": () => (node.nodes[3] as DelayNode | undefined)?.delayTime ?? null,
        "builtin-delay:delay-feedback": () => (node.nodes[4] as GainNode | undefined)?.gain ?? null,
        "builtin-delay:delay-mix": () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        "builtin-gain:gain-level": () => (node.nodes[0] as GainNode | undefined)?.gain ?? null,
        "builtin-limiter:lim-threshold": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        "builtin-limiter:lim-release": () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        "builtin-limiter:lim-ceiling": () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
    };

    const resolver = paramMap[`${deviceType}:${parameterId}`];
    if (resolver) {
        return resolver();
    }
    return null;
};

const interpolateValue = (p1: AutomationPoint, p2: AutomationPoint, beat: number): number => {
    if (p2.beat === p1.beat) {
        return p1.value;
    }
    if (p1.curve === "step") {
        return p1.value;
    }
    const t = (beat - p1.beat) / (p2.beat - p1.beat);
    if (p1.curve === "exponential") {
        return p1.value + (p2.value - p1.value) * t * t;
    }
    return p1.value + (p2.value - p1.value) * t;
};

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

const scheduleAutomationOnParam = (
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[],
): void => {
    if (points.length === 0) {
        return;
    }

    const sorted = [...points].sort((a, b) => a.beat - b.beat);

    param.setValueAtTime(sorted[0]!.value, 0);

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i]!;
        const next = sorted[i + 1];
        const currentTime = beatToSeconds(current.beat, defaultTempo, changes);

        if (currentTime > durationSeconds) {
            break;
        }

        param.setValueAtTime(current.value, Math.max(0, currentTime));

        if (!next) {
            break;
        }

        const nextTime = beatToSeconds(next.beat, defaultTempo, changes);

        if (current.curve === "step") {
            param.setValueAtTime(current.value, Math.max(0, nextTime - 0.0001));
        } else if (current.curve === "linear") {
            param.linearRampToValueAtTime(next.value, Math.min(nextTime, durationSeconds));
        } else {
            const steps = Math.max(2, Math.ceil((nextTime - currentTime) / AUTOMATION_SAMPLE_INTERVAL_SEC));
            for (let s = 1; s <= steps; s++) {
                const fraction = s / steps;
                const sampleBeat = current.beat + (next.beat - current.beat) * fraction;
                const sampleTime = beatToSeconds(sampleBeat, defaultTempo, changes);
                if (sampleTime > durationSeconds) {
                    break;
                }
                const value = interpolateValue(current, next, sampleBeat);
                param.linearRampToValueAtTime(value, sampleTime);
            }
        }
    }
};

const scheduleTrackAutomation = (
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: DeviceNodeEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[],
): void => {
    const trackLanes = lanes.filter((l) => l.trackId === trackId && !l.clipId);

    for (const lane of trackLanes) {
        if (lane.points.length === 0) {
            continue;
        }

        if (lane.parameterId === "gain") {
            scheduleAutomationOnParam(trackGainNode.gain, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        if (lane.parameterId === "pan") {
            scheduleAutomationOnParam(trackPanNode.pan, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        const deviceEntry = deviceEntries.find((e) => {
            const prefix = `${e.deviceId}:`;
            return lane.parameterId.startsWith(prefix);
        });
        if (deviceEntry) {
            const paramKey = lane.parameterId.slice(lane.parameterId.indexOf(":") + 1);
            const audioParam = resolveDeviceParam(deviceEntry.deviceType, paramKey, deviceEntry.node);
            if (audioParam) {
                scheduleAutomationOnParam(audioParam, lane.points, durationSeconds, defaultTempo, changes);
            }
            continue;
        }

        const directEntry = deviceEntries.find((e) => {
            return resolveDeviceParam(e.deviceType, lane.parameterId, e.node) !== null;
        });
        if (directEntry) {
            const audioParam = resolveDeviceParam(directEntry.deviceType, lane.parameterId, directEntry.node);
            if (audioParam) {
                scheduleAutomationOnParam(audioParam, lane.points, durationSeconds, defaultTempo, changes);
            }
        }
    }
};

export const renderOffline = async (
    durationBeats: number,
    sampleRate = 44100,
): Promise<AudioBuffer> => {
    const transport = transportStore.value;
    const tracks = trackStore.value;
    const midi = midiStore.value;
    const tempoMap = tempoMapStore.value;
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(offlineCtx.destination);

    const automationLanes = automationStore.value?.lanes ?? [];

    if (tracks && midi) {
        for (const track of tracks.tracks) {
            if (track.muted || track.kind === "folder") {
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

            const deviceEntries = buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
            trackPan.connect(masterGain);

            scheduleTrackAutomation(
                automationLanes,
                track.id,
                trackGain,
                trackPan,
                deviceEntries,
                durationSeconds,
                defaultTempo,
                changes,
            );

            const resolvedClips = resolveClipsWithComping(track.id, track.clips);

            for (const clip of resolvedClips) {
                const clipVisualLength = clip.endBeat - clip.startBeat;
                const loopLen = clip.loopEnabled
                    ? (clip.loopLength ?? clipVisualLength)
                    : clipVisualLength;
                const maxIterations = clip.loopEnabled
                    ? Math.ceil(clipVisualLength / loopLen)
                    : 1;

                if (clip.type === "midi") {
                    const notes = midi.notesByClipId[clip.id];
                    if (!notes) {
                        continue;
                    }

                    const drumKit = resolveDrumKit(track.devices);
                    const synthParams = drumKit ? null : getSynthParamsForTrack(track.id);

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

                            if (drumKit) {
                                scheduleKitNote(offlineCtx, trackGain, drumKit, note.pitch, startTime, duration, note.velocity);
                            } else {
                                scheduleNote(offlineCtx, trackGain, note.pitch, startTime, duration, note.velocity, synthParams!);
                            }
                        }
                    }
                } else if (clip.type === "audio" && clip.audioBufferId) {
                    const buffer = audioBufferCache.get(clip.audioBufferId);
                    if (!buffer) {
                        continue;
                    }

                    const stretchRatio = (clip.stretchMode && clip.stretchMode !== "off")
                        ? (clip.stretchRatio ?? 1)
                        : 1;

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
};

export const exportStems = async (
    durationBeats: number,
    sampleRate = 44100,
): Promise<Map<string, AudioBuffer>> => {
    const tracks = trackStore.value;
    const midi = midiStore.value;
    const transport = transportStore.value;
    const tempoMap = tempoMapStore.value;
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);
    const stems = new Map<string, AudioBuffer>();

    if (!tracks || !midi) {
        return stems;
    }

    const stemsAutomationLanes = automationStore.value?.lanes ?? [];

    for (const track of tracks.tracks) {
        if (track.kind === "folder" || track.kind === "master") {
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

        const deviceEntries = buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
        trackPan.connect(offlineCtx.destination);

        scheduleTrackAutomation(
            stemsAutomationLanes,
            track.id,
            trackGain,
            trackPan,
            deviceEntries,
            durationSeconds,
            defaultTempo,
            changes,
        );

        const resolvedClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedClips) {
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopLen = clip.loopEnabled
                ? (clip.loopLength ?? clipVisualLength)
                : clipVisualLength;
            const maxIterations = clip.loopEnabled
                ? Math.ceil(clipVisualLength / loopLen)
                : 1;

            if (clip.type === "midi") {
                const notes = midi.notesByClipId[clip.id];
                if (!notes) {
                    continue;
                }

                const drumKit = resolveDrumKit(track.devices);
                const synthParams = drumKit ? null : getSynthParamsForTrack(track.id);

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

                        if (drumKit) {
                            scheduleKitNote(offlineCtx, trackGain, drumKit, note.pitch, startTime, duration, note.velocity);
                        } else {
                            scheduleNote(offlineCtx, trackGain, note.pitch, startTime, duration, note.velocity, synthParams!);
                        }
                    }
                }
            } else if (clip.type === "audio" && clip.audioBufferId) {
                const audioBuf = audioBufferCache.get(clip.audioBufferId);
                if (!audioBuf) {
                    continue;
                }

                const stretchRatio = (clip.stretchMode && clip.stretchMode !== "off")
                    ? (clip.stretchRatio ?? 1)
                    : 1;

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
};

export const audioBufferToWav = (buffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): ArrayBuffer => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const bitsPerSample = bitDepth;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const fmtSize = isFloat ? 18 : 16;
    const headerLength = 20 + fmtSize + 8;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, isFloat ? 3 : 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    if (isFloat) view.setUint16(36, 0, true);

    const dataOffset = 12 + 8 + fmtSize;
    writeString(dataOffset, "data");
    view.setUint32(dataOffset + 4, dataLength, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    const tpdfDither = (): number => Math.random() - Math.random();

    let offset = dataOffset + 8;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
            if (bitDepth === 16) {
                const dithered = sample + tpdfDither() / 0x8000;
                const clamped = Math.max(-1, Math.min(1, dithered));
                view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
            } else if (bitDepth === 24) {
                const val = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
                const int = Math.round(val);
                view.setUint8(offset, int & 0xFF);
                view.setUint8(offset + 1, (int >> 8) & 0xFF);
                view.setUint8(offset + 2, (int >> 16) & 0xFF);
            } else {
                view.setFloat32(offset, sample, true);
            }
            offset += bytesPerSample;
        }
    }

    return arrayBuffer;
};

export const downloadWav = (buffer: AudioBuffer, filename = "export.wav", bitDepth: 16 | 24 | 32 = 16): void => {
    const wav = audioBufferToWav(buffer, bitDepth);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

type LameEncoder = {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
};

type LameModule = {
    Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LameEncoder;
};

const encodePcmToMp3 = (buffer: AudioBuffer, encoder: LameEncoder): Uint8Array => {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const left = new Int16Array(buffer.length);
    const right = numChannels === 2 ? new Int16Array(buffer.length) : left;

    const leftFloat = buffer.getChannelData(0);
    const rightFloat = numChannels === 2 ? buffer.getChannelData(1) : leftFloat;

    for (let i = 0; i < buffer.length; i++) {
        left[i] = Math.max(-32768, Math.min(32767, Math.round(leftFloat[i]! * 32767)));
        right[i] = Math.max(-32768, Math.min(32767, Math.round(rightFloat[i]! * 32767)));
    }

    const chunks: Int8Array[] = [];
    const BLOCK = 1152;

    for (let i = 0; i < buffer.length; i += BLOCK) {
        const leftChunk = left.subarray(i, i + BLOCK);
        const rightChunk = numChannels === 2 ? right.subarray(i, i + BLOCK) : undefined;
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
            chunks.push(mp3buf);
        }
    }

    const tail = encoder.flush();
    if (tail.length > 0) {
        chunks.push(tail);
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
        offset += chunk.length;
    }

    return result;
};

export const downloadMp3 = async (buffer: AudioBuffer, filename = "export.mp3", bitRate = 128): Promise<void> => {
    const lamejs = (await import("lamejs")) as unknown as LameModule;
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const encoder = new lamejs.Mp3Encoder(numChannels, buffer.sampleRate, bitRate);
    const mp3Data = encodePcmToMp3(buffer, encoder);
    const blob = new Blob([mp3Data.buffer as ArrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// FLAC encoder — verbatim (uncompressed) subframes, 16-bit signed PCM
// Produces valid FLAC files that any decoder can read.
// ---------------------------------------------------------------------------

const CRC8_POLY = 0x07;
const CRC16_POLY = 0x8005;

const buildCrc8Table = (): Uint8Array => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ CRC8_POLY) & 0xFF : (crc << 1) & 0xFF;
        }
        table[i] = crc;
    }
    return table;
};

const buildCrc16Table = (): Uint16Array => {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ CRC16_POLY) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
        table[i] = crc;
    }
    return table;
};

const CRC8_TABLE = buildCrc8Table();
const CRC16_TABLE = buildCrc16Table();

const crc8 = (data: Uint8Array, start: number, end: number): number => {
    let crc = 0;
    for (let i = start; i < end; i++) {
        crc = CRC8_TABLE[crc ^ data[i]!]!;
    }
    return crc;
};

const crc16 = (data: Uint8Array, start: number, end: number): number => {
    let crc = 0;
    for (let i = start; i < end; i++) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]!) & 0xFF]!) & 0xFFFF;
    }
    return crc;
};

const encodeUtf8Number = (n: number): number[] => {
    if (n < 0x80) {
        return [n];
    }
    if (n < 0x800) {
        return [0xC0 | (n >> 6), 0x80 | (n & 0x3F)];
    }
    if (n < 0x10000) {
        return [0xE0 | (n >> 12), 0x80 | ((n >> 6) & 0x3F), 0x80 | (n & 0x3F)];
    }
    if (n < 0x200000) {
        return [
            0xF0 | (n >> 18),
            0x80 | ((n >> 12) & 0x3F),
            0x80 | ((n >> 6) & 0x3F),
            0x80 | (n & 0x3F),
        ];
    }
    if (n < 0x4000000) {
        return [
            0xF8 | (n >> 24),
            0x80 | ((n >> 18) & 0x3F),
            0x80 | ((n >> 12) & 0x3F),
            0x80 | ((n >> 6) & 0x3F),
            0x80 | (n & 0x3F),
        ];
    }
    return [
        0xFC | (n >> 30),
        0x80 | ((n >> 24) & 0x3F),
        0x80 | ((n >> 18) & 0x3F),
        0x80 | ((n >> 12) & 0x3F),
        0x80 | ((n >> 6) & 0x3F),
        0x80 | (n & 0x3F),
    ];
};

const FLAC_BLOCK_SIZE = 4096;

const encodeFlac = (buffer: AudioBuffer): Uint8Array => {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;
    const bitsPerSample = 16;

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    const frameCount = Math.ceil(totalSamples / FLAC_BLOCK_SIZE);
    const maxFrameBytes = 16 + numChannels * FLAC_BLOCK_SIZE * 2 + 2;
    const estimatedSize = 42 + frameCount * maxFrameBytes;
    const out = new Uint8Array(estimatedSize);
    let pos = 0;

    const writeByte = (b: number) => {
        out[pos++] = b & 0xFF;
    };
    const writeBe16 = (v: number) => {
        out[pos++] = (v >> 8) & 0xFF;
        out[pos++] = v & 0xFF;
    };
    const writeBe24 = (v: number) => {
        out[pos++] = (v >> 16) & 0xFF;
        out[pos++] = (v >> 8) & 0xFF;
        out[pos++] = v & 0xFF;
    };

    // "fLaC" stream marker
    out[pos++] = 0x66; // f
    out[pos++] = 0x4C; // L
    out[pos++] = 0x61; // a
    out[pos++] = 0x43; // C

    // STREAMINFO metadata block (last block = 0x80 flag, type 0, length 34)
    writeByte(0x80);
    writeBe24(34);

    // min/max block size
    writeBe16(FLAC_BLOCK_SIZE);
    writeBe16(FLAC_BLOCK_SIZE);

    // min/max frame size (0 = unknown)
    writeBe24(0);
    writeBe24(0);

    // sample rate (20 bits) | channels-1 (3 bits) | bps-1 (5 bits) | total samples high 4 bits
    const srHigh = (sampleRate >> 12) & 0xFF;
    const srMid = (sampleRate >> 4) & 0xFF;
    const srLowAndChannels = ((sampleRate & 0xF) << 4) | ((numChannels - 1) << 1) | ((bitsPerSample - 1) >> 4);
    const bpsLowAndSamplesHigh = (((bitsPerSample - 1) & 0xF) << 4) | ((totalSamples >> 32) & 0xF);

    writeByte(srHigh);
    writeByte(srMid);
    writeByte(srLowAndChannels);
    writeByte(bpsLowAndSamplesHigh);

    // total samples low 32 bits
    out[pos++] = (totalSamples >>> 24) & 0xFF;
    out[pos++] = (totalSamples >>> 16) & 0xFF;
    out[pos++] = (totalSamples >>> 8) & 0xFF;
    out[pos++] = totalSamples & 0xFF;

    // MD5 signature (16 bytes of zeros — not computed for verbatim encoding)
    for (let i = 0; i < 16; i++) {
        writeByte(0);
    }

    // Audio frames
    let sampleOffset = 0;
    let frameNumber = 0;

    while (sampleOffset < totalSamples) {
        const blockSize = Math.min(FLAC_BLOCK_SIZE, totalSamples - sampleOffset);
        const frameStart = pos;

        // Frame header sync code: 0xFFF8 (fixed block size, 16-bit)
        writeBe16(0xFFF8);

        // Block size code and sample rate code
        // blockSize=4096 → code 0xC (4096), unless last frame is smaller
        let blockSizeCode: number;
        let blockSizeExtraBits = 0;
        if (blockSize === 4096) {
            blockSizeCode = 0xC;
        } else if (blockSize <= 255) {
            blockSizeCode = 0x6; // 8-bit end-of-stream block size follows
            blockSizeExtraBits = 8;
        } else {
            blockSizeCode = 0x7; // 16-bit end-of-stream block size follows
            blockSizeExtraBits = 16;
        }

        // Sample rate code: 0 = get from STREAMINFO
        writeByte((blockSizeCode << 4) | 0x00);

        // Channel assignment (independent) | sample size (16-bit = 0x4) | reserved bit 0
        writeByte(((numChannels - 1) << 4) | (0x4 << 1) | 0);

        // Frame number in UTF-8 coding
        const utf8Bytes = encodeUtf8Number(frameNumber);
        for (const b of utf8Bytes) {
            writeByte(b);
        }

        // Extra block size bytes
        if (blockSizeExtraBits === 8) {
            writeByte(blockSize - 1);
        } else if (blockSizeExtraBits === 16) {
            writeBe16(blockSize - 1);
        }

        // CRC-8 of frame header
        const headerCrc = crc8(out, frameStart, pos);
        writeByte(headerCrc);

        // Subframes — one per channel, verbatim type
        for (let ch = 0; ch < numChannels; ch++) {
            // Subframe header: 0 padding (1 bit) | type verbatim=01 (6 bits) | no wasted bits (1 bit)
            // verbatim subframe type = 0b000001 → header byte = 0b0_000001_0 = 0x02
            writeByte(0x02);

            const channelData = channels[ch]!;
            for (let i = 0; i < blockSize; i++) {
                const sample = Math.max(-1, Math.min(1, channelData[sampleOffset + i]!));
                const int16 = sample < 0
                    ? Math.round(sample * 0x8000)
                    : Math.round(sample * 0x7FFF);
                writeBe16(int16 & 0xFFFF);
            }
        }

        // Byte-align (already aligned since 16-bit samples)

        // CRC-16 of entire frame
        const frameCrc = crc16(out, frameStart, pos);
        writeBe16(frameCrc);

        sampleOffset += blockSize;
        frameNumber++;
    }

    return out.subarray(0, pos);
};

export const downloadFlac = (buffer: AudioBuffer, filename = "export.flac"): void => {
    const flacData = encodeFlac(buffer);
    const blob = new Blob([flacData.buffer as ArrayBuffer], { type: "audio/flac" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};
