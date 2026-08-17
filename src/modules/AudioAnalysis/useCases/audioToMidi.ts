import { addClip, getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

import { detectOnsets, type DetectedOnset } from './detectOnsets';
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

function freqToMidiPitch(freq: number): number {
    return Math.round(69 + 12 * Math.log2(freq / 440));
}

function detectPitchForOnsets(onsets: DetectedOnset[], buffer: AudioBuffer, targetPitch: number): DetectedOnset[] {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
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
 * onsets detected, or MIDI track resolution failed) instead of assuming success whenever the
 * call completes without throwing — this function never throws.
 */
export function audioToMidi(options: AudioToMidiOptions): boolean {
    const { clipId, trackId, sensitivity = 0.5, minInterval = 0.25, targetPitch = 36, mode = 'rhythm' } = options;

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

    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;
    const minIntervalSec = minInterval / beatsPerSecond;

    let onsets = detectOnsets(buffer, sensitivity, minIntervalSec);

    if (mode === 'pitched') {
        onsets = detectPitchForOnsets(onsets, buffer, targetPitch);
    }

    if (onsets.length === 0) {
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
    for (const output of onsets) {
        if (output.amplitude > maxAmplitude) {
            maxAmplitude = output.amplitude;
        }
    }

    for (let index = 0; index < onsets.length; index++) {
        const onset = onsets[index]!;
        const startBeat = onset.timeSec * beatsPerSecond;
        const nextOnsetBeat = index < onsets.length - 1 ? onsets[index + 1]!.timeSec * beatsPerSecond : startBeat + 1;
        const duration = Math.max(minInterval, (nextOnsetBeat - startBeat) * 0.9);
        const velocity = Math.max(1, Math.min(127, Math.round((onset.amplitude / maxAmplitude) * 127)));
        const pitch = mode === 'pitched' && onset.pitch !== undefined ? onset.pitch : targetPitch;

        addMidiNote(midiClip.id, pitch, startBeat, duration, velocity);
    }

    return true;
}
