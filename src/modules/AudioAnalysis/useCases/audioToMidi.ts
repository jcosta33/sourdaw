import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { getAudioTimelineElapsedSeconds, projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { frequencyToMidiNote } from '#/utils/pitch';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { detectOnsets, type DetectedOnset, type OnsetDetectionSource } from './detectOnsets';
import { resolveMidiTrackId } from './resolveMidiTrackId';

export type AudioToMidiOptions = {
    clipId: string;
    trackId: string;
    sensitivity?: number;
    minInterval?: number;
    targetPitch?: number;
    mode?: 'rhythm' | 'pitched';
};

const FRAME_SIZE = 1024;

/**
 * Autocorrelation-based pitch estimation on a windowed sample region.
 * Returns frequency in Hz, or 0 if no clear pitch is found.
 */
function estimatePitch(data: Float32Array, start: number, length: number, sampleRate: number): number {
    const end = Math.min(start + length, data.length);
    const actual = end - start;
    if (actual < 64) {
        return 0;
    }

    const minLag = Math.floor(sampleRate / 2000);
    const maxLag = Math.floor(sampleRate / 50);
    const searchEnd = Math.min(maxLag, Math.floor(actual / 2));

    if (searchEnd <= minLag) {
        return 0;
    }

    let bestLag = 0;
    let bestCorr = -1;
    let energy = 0;

    for (let index = start; index < start + searchEnd; index++) {
        energy += data[index]! * data[index]!;
    }

    if (energy < 1e-8) {
        return 0;
    }

    for (let lag = minLag; lag < searchEnd; lag++) {
        let corr = 0;
        for (let index = 0; index < searchEnd - lag; index++) {
            corr += data[start + index]! * data[start + index + lag]!;
        }
        corr /= energy;

        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    if (bestCorr < 0.3 || bestLag === 0) {
        return 0;
    }

    return sampleRate / bestLag;
}

type ClipPlaybackFields = {
    startBeat: number;
    endBeat: number;
    audioOffsetBeats?: number;
    audioOffsetSeconds?: number;
    audioLoopStartSeconds?: number;
    loopOriginBeat?: number;
    stretchMode?: string;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
};

type AudibleSourceSpan = {
    iterationStartBeat: number;
    iterationEndBeat: number;
    iterationStartSeconds: number;
    sourceOffsetSeconds: number;
    stretchRatio: number;
    startSec: number;
    durationSec: number;
};

type AudibleClipWindow = {
    spans: AudibleSourceSpan[];
};

/**
 * The source spans the offline scheduler would play for this clip: trim, slip,
 * stretch, and loop, integrating the song clock for every occurrence.
 */
function projectAudibleClipWindow(
    clip: ClipPlaybackFields,
    tempo: number,
    bufferDurationSec: number
): AudibleClipWindow | null {
    const clipBeats = clip.endBeat - clip.startBeat;
    if (!Number.isFinite(clipBeats) || clipBeats <= 0) {
        return null;
    }

    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const secondsAtBeat = (beat: number) => readSecondsAtBeat({ beat });
    const spans: AudibleSourceSpan[] = [];
    for (let iteration = 0; iteration < loop.iterationCount; iteration++) {
        const passStart = clip.startBeat + iteration * loop.loopLengthBeats;
        const passEnd = Math.min(clip.endBeat, passStart + loop.loopLengthBeats);
        for (const segment of projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: loop.loopLengthBeats,
            iterationStartBeat: passStart,
            iterationEndBeat: passEnd,
            stretchRatio,
            tempoAtClipStart: tempo,
            secondsAtBeat,
        })) {
            const iterationStartBeat = passStart + segment.startOffsetBeats;
            const iterationEndBeat = passStart + segment.endOffsetBeats;
            const iterationStartSeconds = secondsAtBeat(iterationStartBeat);
            const offsetSec = segment.sourceStartSeconds;
            const baseBufferOffsetSec = Math.max(0, offsetSec);
            const sourcePreRollSec = Math.max(0, -offsetSec) / stretchRatio;
            const sourceDurationSec = Math.min(
                Math.max(0, secondsAtBeat(iterationEndBeat) - iterationStartSeconds - sourcePreRollSec) * stretchRatio,
                Math.max(0, bufferDurationSec - baseBufferOffsetSec)
            );
            if (sourceDurationSec > 0) {
                spans.push({
                    iterationStartBeat,
                    iterationEndBeat,
                    iterationStartSeconds,
                    sourceOffsetSeconds: offsetSec,
                    stretchRatio,
                    startSec: baseBufferOffsetSec,
                    durationSec: sourceDurationSec,
                });
            }
        }
    }

    return { spans };
}

function windowedOnsetSource(
    buffer: AudioBuffer,
    startSec: number,
    durationSec: number
): { source: OnsetDetectionSource; startSec: number } | null {
    if (!Number.isFinite(startSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
        return null;
    }
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.min(channel.length, Math.floor(startSec * sampleRate)));
    const endSample = Math.max(
        startSample,
        Math.min(channel.length, Math.floor((startSec + durationSec) * sampleRate))
    );
    if (endSample <= startSample) {
        return null;
    }
    const samples = channel.subarray(startSample, endSample);
    return { source: { sampleRate, getChannelData: () => samples }, startSec: startSample / sampleRate };
}

function freqToMidiPitch(freq: number): number {
    return Math.round(frequencyToMidiNote(freq));
}

function detectPitchForOnsets(
    onsets: DetectedOnset[],
    source: OnsetDetectionSource,
    targetPitch: number
): DetectedOnset[] {
    const channelData = source.getChannelData(0);
    const sampleRate = source.sampleRate;
    const windowSamples = FRAME_SIZE * 2;

    return onsets.map((onset) => {
        const onsetSample = Math.max(0, Math.floor(onset.timeSec * sampleRate));
        // Slide the window left so a full `windowSamples` span fits inside the clip;
        // onsets near the right edge would otherwise leave estimatePitch with a silently
        // shrunk window, yielding an unreliable lag (or tripping its `actual < 64` guard).
        const maxStart = Math.max(0, channelData.length - windowSamples);
        const startSample = Math.min(onsetSample, maxStart);
        const freq = estimatePitch(channelData, startSample, windowSamples, sampleRate);

        if (freq > 0) {
            const midi = freqToMidiPitch(freq);
            if (midi >= 0 && midi <= 127) {
                return { ...onset, pitch: midi };
            }
        }
        return { ...onset, pitch: targetPitch };
    });
}

/**
 * Detect onsets in `options.clipId`'s cached audio and write them as MIDI notes on a
 * (possibly newly-created) MIDI track. Returns whether a MIDI clip was actually produced,
 * so callers can distinguish a real conversion from a silent no-op (clip/buffer missing, no
 * onsets detected, or MIDI track resolution failed) or a failed write (e.g. `addMidiNote`
 * throwing because the MIDI store isn't initialized) instead of assuming success whenever the
 * call completes. Like `handlePolyMidi`'s conversion path, the fallible body is caught here so
 * callers only ever need to branch on the boolean return, never on a thrown error.
 */
export async function audioToMidi(options: AudioToMidiOptions): Promise<boolean> {
    const { clipId, trackId, sensitivity = 0.5, minInterval = 0.25, targetPitch = 36, mode = 'rhythm' } = options;

    try {
        const clip = getAllTracks()
            .flatMap((time) => time.clips)
            .find((context) => context.id === clipId);
        if (!clip) {
            return false;
        }

        const bufferId = clip.audioBufferId ?? clipId;
        const buffer = getCachedAudioBuffer({ bufferId });
        if (!buffer) {
            return false;
        }

        const tempo = readTempoAtBeat({ beat: clip.startBeat });
        const audible = projectAudibleClipWindow(clip, tempo, buffer.duration);
        if (!audible) {
            return false;
        }

        const transcribed: Array<{ startBeat: number; amplitude: number; pitch?: number }> = [];

        for (const span of audible.spans) {
            const window = windowedOnsetSource(buffer, span.startSec, span.durationSec);
            if (!window) {
                continue;
            }

            // Detect without a flat seconds gate, then enforce the user's
            // musical interval after each onset has its actual song beat.
            let onsets = detectOnsets(window.source, sensitivity, 0);
            if (mode === 'pitched') {
                onsets = detectPitchForOnsets(onsets, window.source, targetPitch);
            }

            for (const onset of onsets) {
                const sourceSeconds = window.startSec + onset.timeSec;
                const songSeconds =
                    span.iterationStartSeconds +
                    getAudioTimelineElapsedSeconds(span.sourceOffsetSeconds, sourceSeconds, span.stretchRatio);
                const noteStartBeat = readBeatAtSamples({ samples: songSeconds, sampleRate: 1 });
                if (noteStartBeat < span.iterationStartBeat || noteStartBeat >= span.iterationEndBeat) {
                    continue;
                }
                const previous = transcribed.at(-1);
                if (previous && noteStartBeat - previous.startBeat < minInterval) {
                    continue;
                }
                transcribed.push({ startBeat: noteStartBeat, amplitude: onset.amplitude, pitch: onset.pitch });
            }
        }

        if (transcribed.length === 0) {
            return false;
        }

        const destination = resolveMidiTrackId(trackId, `${clip.name} (MIDI)`);
        const midiClipId = `clip-audio-midi-${crypto.randomUUID()}`;
        const clipStartBeat = clip.startBeat;
        const actions: AppAction[] = [
            ...destination.actions,
            {
                type: 'addClip',
                payload: {
                    id: midiClipId,
                    trackId: destination.trackId,
                    startBeat: clipStartBeat,
                    endBeat: Math.ceil(clip.endBeat),
                    name: `${clip.name} → MIDI`,
                    type: 'midi',
                },
            },
        ];
        let maxAmplitude = 1e-8;
        for (const output of transcribed) {
            if (output.amplitude > maxAmplitude) {
                maxAmplitude = output.amplitude;
            }
        }

        const notes = [];
        for (let index = 0; index < transcribed.length; index++) {
            const onset = transcribed[index]!;
            const startBeat = onset.startBeat - clipStartBeat;
            const nextOnsetBeat =
                index < transcribed.length - 1 ? transcribed[index + 1]!.startBeat - clipStartBeat : startBeat + 1;
            const duration = Math.max(minInterval, (nextOnsetBeat - startBeat) * 0.9);
            const velocity = Math.max(1, Math.min(127, Math.round((onset.amplitude / maxAmplitude) * 127)));
            const pitch = mode === 'pitched' && onset.pitch !== undefined ? onset.pitch : targetPitch;

            notes.push({ pitch, startBeat, duration, velocity });
        }
        actions.push({ type: 'addNotes', payload: { clipId: midiClipId, notes } });
        const result = await executeAppActionBatch(actions, {
            groupId: `audio-to-midi-${crypto.randomUUID()}`,
            groupLabel: 'Convert audio to MIDI',
            source: 'manual',
            requireCompensation: true,
        });
        return result.status === 'committed' || result.status === 'committed-with-warning';
    } catch {
        return false;
    }
}
