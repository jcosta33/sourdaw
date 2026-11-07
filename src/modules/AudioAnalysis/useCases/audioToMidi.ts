import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import {
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { type AppAction } from '#/utils/handlerContract';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND } from '#/utils/midiNoteBatchLimits';
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
    signal?: AbortSignal;
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

type ClipPlaybackFields = ReturnType<typeof getAllTracks>[number]['clips'][number];

type AudibleSourceSpan = {
    /** Absolute song second where this source read first sounds, pre-roll included. */
    timelineStartSec: number;
    /** The first source second this segment reads. */
    startSec: number;
    /** The source seconds this segment reads. */
    durationSec: number;
};

type AudibleClipWindow = {
    clipBeats: number;
    secondsPerBeat: number;
    stretchRatio: number;
    spans: AudibleSourceSpan[];
};

/**
 * The physical source spans live playback reads for a raw clip. The shared
 * projector owns its canonical entry, wrap, and original pass seams; the
 * Transport reader owns the tempo map along each destination span.
 */
function projectAudibleClipWindow(
    clip: ClipPlaybackFields,
    tempo: number,
    bufferDurationSec: number,
    secondsAtBeat: (beat: number) => number
): AudibleClipWindow | null {
    const clipBeats = clip.endBeat - clip.startBeat;
    if (!Number.isFinite(clipBeats) || clipBeats <= 0) {
        return null;
    }

    const secondsPerBeat = 60 / tempo;
    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const loopLen = loop.loopLengthBeats;

    const spans: AudibleSourceSpan[] = [];
    for (let iteration = 0; iteration < loop.iterationCount && iteration * loopLen < clipBeats; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * loopLen;
        const iterationEndBeat = Math.min(clip.endBeat, iterationStartBeat + loopLen);
        const segments = projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: loopLen,
            iterationStartBeat,
            iterationEndBeat,
            stretchRatio,
            tempoAtClipStart: tempo,
            secondsAtBeat,
        });
        for (const segment of segments) {
            const segmentSourceStartSec = segment.sourceStartSeconds;
            const segmentStartSec = secondsAtBeat(iterationStartBeat + segment.startOffsetBeats);
            const segmentEndSec = secondsAtBeat(iterationStartBeat + segment.endOffsetBeats);
            const segmentPreRollSec = Math.max(0, -segmentSourceStartSec) / stretchRatio;
            const timelineStartSec = segmentStartSec + segmentPreRollSec;
            const audibleDestSec = segmentEndSec - timelineStartSec;
            if (!(audibleDestSec > 0)) {
                continue;
            }
            const segmentBufferStartSec = Math.max(0, segmentSourceStartSec);
            const remainingBufferSourceSec = Math.max(0, bufferDurationSec - segmentBufferStartSec);
            const sourceDurationSec = Math.min(audibleDestSec * stretchRatio, remainingBufferSourceSec);
            if (!(sourceDurationSec > 0)) {
                continue;
            }
            spans.push({
                timelineStartSec,
                startSec: segmentBufferStartSec,
                durationSec: sourceDurationSec,
            });
        }
    }

    return {
        clipBeats,
        secondsPerBeat,
        stretchRatio,
        spans,
    };
}

function windowedOnsetSource(buffer: AudioBuffer, startSec: number, durationSec: number): OnsetDetectionSource | null {
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
    return {
        sampleRate,
        getChannelData: () => samples,
    };
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
 * (possibly newly-created) MIDI track. Success means the complete grouped creation
 * committed; missing input, no onsets and refused or failed writes return false.
 */
export async function audioToMidi(options: AudioToMidiOptions): Promise<boolean> {
    const {
        clipId,
        trackId,
        sensitivity = 0.5,
        minInterval = 0.25,
        targetPitch = 36,
        mode = 'rhythm',
        signal,
    } = options;

    try {
        if (signal?.aborted) {
            return false;
        }
        const projectRevision = settlePendingProjectWritesAndCaptureRevision();
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
        const secondsAtBeat = (beat: number) => readSecondsAtBeat({ beat });
        const audible = projectAudibleClipWindow(clip, tempo, buffer.duration, secondsAtBeat);
        if (!audible) {
            return false;
        }

        const minIntervalSec = minInterval * audible.secondsPerBeat;
        const transcribed: Array<{ startBeat: number; amplitude: number; pitch?: number }> = [];

        for (const span of audible.spans) {
            const source = windowedOnsetSource(buffer, span.startSec, span.durationSec);
            if (!source) {
                continue;
            }

            let onsets = detectOnsets(source, sensitivity, minIntervalSec);
            if (mode === 'pitched') {
                onsets = detectPitchForOnsets(onsets, source, targetPitch);
            }

            for (const onset of onsets) {
                const onsetSongSeconds = span.timelineStartSec + onset.timeSec / audible.stretchRatio;
                const noteStartBeat = readBeatAtSamples({ samples: onsetSongSeconds, sampleRate: 1 }) - clip.startBeat;
                if (noteStartBeat < 0 || noteStartBeat >= audible.clipBeats) {
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
        const endBeat = clip.endBeat;
        const actions: AppAction[] = [
            ...destination.actions,
            {
                type: 'addClip',
                payload: {
                    id: midiClipId,
                    trackId: destination.trackId,
                    startBeat: clipStartBeat,
                    endBeat: Math.ceil(endBeat),
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
            const startBeat = onset.startBeat;
            const nextOnsetBeat = index < transcribed.length - 1 ? transcribed[index + 1]!.startBeat : startBeat + 1;
            const duration = Math.max(minInterval, (nextOnsetBeat - startBeat) * 0.9);
            const velocity = Math.max(1, Math.min(127, Math.round((onset.amplitude / maxAmplitude) * 127)));
            const pitch = mode === 'pitched' && onset.pitch !== undefined ? onset.pitch : targetPitch;

            notes.push({ pitch, startBeat, duration, velocity });
        }
        for (let offset = 0; offset < notes.length; offset += ADD_NOTES_MAX_NOTES_PER_COMMAND) {
            actions.push({
                type: 'addNotes',
                payload: { clipId: midiClipId, notes: notes.slice(offset, offset + ADD_NOTES_MAX_NOTES_PER_COMMAND) },
            });
        }
        const result = await executeAppActionBatch(actions, {
            groupId: `audio-to-midi-${crypto.randomUUID()}`,
            groupLabel: 'Convert audio to MIDI',
            source: 'manual',
            requireCompensation: true,
            signal,
            shouldExecute: () =>
                signal?.aborted !== true && projectRevisionMatchesLiveIgnoringSaveWrites(projectRevision),
        });
        return result.status === 'committed' || result.status === 'committed-with-warning';
    } catch {
        return false;
    }
}
