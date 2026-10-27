import { addClip, getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
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
    stretchMode?: string;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    loopOriginBeat?: number;
};

type AudibleSourceSpan = {
    iteration: number;
    /** The beat inside the pass where this segment's sound begins, pre-roll included. */
    passStartBeats: number;
    /** The first source second this segment reads. */
    startSec: number;
    /** The source seconds this segment reads. */
    durationSec: number;
};

type AudibleClipWindow = {
    clipBeats: number;
    secondsPerBeat: number;
    stretchRatio: number;
    loopLengthBeats: number;
    spans: AudibleSourceSpan[];
};

/**
 * The source spans the offline scheduler would play for this clip: trim, slip,
 * stretch, and loop, on a flat tempo. Null when the clip has no positive length.
 *
 * A looped clip's passes read the loop region the clip was looped with, in
 * source beats (`audioOffsetBeats - (startBeat - loopOriginBeat)`, #4988),
 * entering at the trim advance's phase — the same read
 * `projectOfflineAudioClipPlaybacks` and the live scheduler recover — so one
 * pass entered past the region head projects as its region tail and wrapped
 * head, two reads, and material past the region end is never read. An
 * unanchored clip — or a stale-anchored one with the loop off — advances zero,
 * which puts the region at the offset with the entry at the region head: the
 * pre-anchor single read, exactly as before.
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

    const secondsPerBeat = 60 / tempo;
    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const loopLen = loop.loopLengthBeats;

    const loopAdvanceBeats = resolveClipLoopOriginAdvance({
        startBeat: clip.startBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const regionStartBeats = (clip.audioOffsetBeats ?? 0) - loopAdvanceBeats;
    const regionEntryBeats = ((loopAdvanceBeats % loopLen) + loopLen) % loopLen;

    // The segments one pass reads, mirroring the offline projector's
    // `buildPassSegments`: the region tail from the entry phase, then the
    // wrapped region head.
    function buildPassSegments(
        passLengthBeats: number
    ): Array<{ startBeat: number; endBeat: number; sourceStartBeats: number }> {
        if (regionEntryBeats <= 0) {
            return [{ startBeat: 0, endBeat: passLengthBeats, sourceStartBeats: regionStartBeats }];
        }
        const headSegmentEndBeat = Math.min(passLengthBeats, loopLen - regionEntryBeats);
        const segments = [
            { startBeat: 0, endBeat: headSegmentEndBeat, sourceStartBeats: regionStartBeats + regionEntryBeats },
        ];
        if (passLengthBeats > headSegmentEndBeat) {
            segments.push({
                startBeat: headSegmentEndBeat,
                endBeat: passLengthBeats,
                sourceStartBeats: regionStartBeats,
            });
        }
        return segments;
    }

    const spans: AudibleSourceSpan[] = [];
    for (let iteration = 0; iteration < loop.iterationCount && iteration * loopLen < clipBeats; iteration++) {
        const remainingBeats = Math.min(loopLen, clipBeats - iteration * loopLen);
        for (const segment of buildPassSegments(remainingBeats)) {
            const segmentSourceStartSec = segment.sourceStartBeats * secondsPerBeat;
            const segmentPreRollSec = Math.max(0, -segmentSourceStartSec) / stretchRatio;
            const audibleDestSec = (segment.endBeat - segment.startBeat) * secondsPerBeat - segmentPreRollSec;
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
                iteration,
                passStartBeats: segment.startBeat + segmentPreRollSec / secondsPerBeat,
                startSec: segmentBufferStartSec,
                durationSec: sourceDurationSec,
            });
        }
    }

    return {
        clipBeats,
        secondsPerBeat,
        stretchRatio,
        loopLengthBeats: loopLen,
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
 * (possibly newly-created) MIDI track. Returns whether a MIDI clip was actually produced,
 * so callers can distinguish a real conversion from a silent no-op (clip/buffer missing, no
 * onsets detected, or MIDI track resolution failed) or a failed write (e.g. `addMidiNote`
 * throwing because the MIDI store isn't initialized) instead of assuming success whenever the
 * call completes. Like `handlePolyMidi`'s conversion path, the fallible body is caught here so
 * callers only ever need to branch on the boolean return, never on a thrown error.
 */
export function audioToMidi(options: AudioToMidiOptions): boolean {
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
                const noteStartBeat =
                    span.iteration * audible.loopLengthBeats +
                    span.passStartBeats +
                    onset.timeSec / audible.stretchRatio / audible.secondsPerBeat;
                if (noteStartBeat < 0 || noteStartBeat >= audible.clipBeats) {
                    continue;
                }
                transcribed.push({ startBeat: noteStartBeat, amplitude: onset.amplitude, pitch: onset.pitch });
            }
        }

        if (transcribed.length === 0) {
            return false;
        }

        const midiTrackId = resolveMidiTrackId(trackId, `${clip.name} (MIDI)`);
        if (!midiTrackId) {
            return false;
        }

        const clipStartBeat = clip.startBeat;
        const endBeat = clip.endBeat;

        const midiClip = addClip({
            trackId: midiTrackId,
            startBeat: clipStartBeat,
            endBeat: Math.ceil(endBeat),
            name: `${clip.name} → MIDI`,
            type: 'midi',
        });

        if (!midiClip) {
            return false;
        }

        let maxAmplitude = 1e-8;
        for (const output of transcribed) {
            if (output.amplitude > maxAmplitude) {
                maxAmplitude = output.amplitude;
            }
        }

        for (let index = 0; index < transcribed.length; index++) {
            const onset = transcribed[index]!;
            const startBeat = onset.startBeat;
            const nextOnsetBeat = index < transcribed.length - 1 ? transcribed[index + 1]!.startBeat : startBeat + 1;
            const duration = Math.max(minInterval, (nextOnsetBeat - startBeat) * 0.9);
            const velocity = Math.max(1, Math.min(127, Math.round((onset.amplitude / maxAmplitude) * 127)));
            const pitch = mode === 'pitched' && onset.pitch !== undefined ? onset.pitch : targetPitch;

            addMidiNote(midiClip.id, pitch, startBeat, duration, velocity);
        }

        return true;
    } catch {
        return false;
    }
}
