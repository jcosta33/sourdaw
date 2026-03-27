import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries/getAllTracks';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { addMidiNote } from '#/modules/MIDI/useCases/midi';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';

export type AudioToMidiOptions = {
    clipId: string;
    trackId: string;
    sensitivity?: number;
    minInterval?: number;
    targetPitch?: number;
    mode?: 'rhythm' | 'pitched';
};

export type DetectedOnset = {
    timeSec: number;
    amplitude: number;
    pitch?: number;
};

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;

function computeRmsEnergy(data: Float32Array, start: number, length: number): number {
    let sum = 0;
    const end = Math.min(start + length, data.length);
    for (let i = start; i < end; i++) {
        sum += data[i]! * data[i]!;
    }
    return Math.sqrt(sum / (end - start));
}

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

    for (let i = start; i < start + searchEnd; i++) {
        energy += data[i]! * data[i]!;
    }

    if (energy < 1e-8) {
        return 0;
    }

    for (let lag = minLag; lag < searchEnd; lag++) {
        let corr = 0;
        for (let i = 0; i < searchEnd - lag; i++) {
            corr += data[start + i]! * data[start + i + lag]!;
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

export function detectOnsets(buffer: AudioBuffer, sensitivity: number, minIntervalSec: number): DetectedOnset[] {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const numFrames = Math.floor((channelData.length - FRAME_SIZE) / HOP_SIZE) + 1;
    if (numFrames < 2) {
        return [];
    }

    const energies = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        energies[i] = computeRmsEnergy(channelData, i * HOP_SIZE, FRAME_SIZE);
    }

    const flux = new Float32Array(numFrames - 1);
    let maxFlux = 0;
    for (let i = 0; i < flux.length; i++) {
        const diff = energies[i + 1]! - energies[i]!;
        flux[i] = Math.max(0, diff);
        if (flux[i]! > maxFlux) {
            maxFlux = flux[i]!;
        }
    }

    if (maxFlux < 1e-8) {
        return [];
    }

    const threshold = sensitivity * maxFlux;
    const onsets: DetectedOnset[] = [];
    const minIntervalFrames = Math.floor((minIntervalSec * sampleRate) / HOP_SIZE);

    let lastOnsetFrame = -minIntervalFrames;

    for (let i = 1; i < flux.length - 1; i++) {
        if (
            flux[i]! > threshold &&
            flux[i]! > flux[i - 1]! &&
            flux[i]! >= flux[i + 1]! &&
            i - lastOnsetFrame >= minIntervalFrames
        ) {
            const timeSec = ((i + 1) * HOP_SIZE) / sampleRate;
            onsets.push({
                timeSec,
                amplitude: energies[i + 1]!,
            });
            lastOnsetFrame = i;
        }
    }

    return onsets;
}

function detectPitchForOnsets(onsets: DetectedOnset[], buffer: AudioBuffer, targetPitch: number): DetectedOnset[] {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const windowSamples = FRAME_SIZE * 2;

    return onsets.map((onset) => {
        const startSample = Math.max(0, Math.floor(onset.timeSec * sampleRate));
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

export function audioToMidi(options: AudioToMidiOptions): void {
    const { clipId, trackId, sensitivity = 0.5, minInterval = 0.25, targetPitch = 36, mode = 'rhythm' } = options;

    const clip = getAllTracks()
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
    if (!clip) {
        return;
    }

    const bufferId = clip.audioBufferId ?? clipId;
    const buffer = audioBufferCache.get(bufferId);
    if (!buffer) {
        return;
    }

    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;
    const minIntervalSec = minInterval / beatsPerSecond;

    let onsets = detectOnsets(buffer, sensitivity, minIntervalSec);

    if (mode === 'pitched') {
        onsets = detectPitchForOnsets(onsets, buffer, targetPitch);
    }

    if (onsets.length === 0) {
        return;
    }

    let midiTrackId = trackId;
    const existingTrack = getAllTracks().find((t) => t.id === trackId);
    if (!existingTrack || existingTrack.kind !== 'midi') {
        const newTrack = addTrack({ name: `${clip.name} (MIDI)`, kind: 'midi' });
        if (!newTrack) {
            return;
        }
        midiTrackId = newTrack.id;
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
        return;
    }

    const maxAmplitude = Math.max(...onsets.map((o) => o.amplitude), 1e-8);

    for (let i = 0; i < onsets.length; i++) {
        const onset = onsets[i]!;
        const startBeat = onset.timeSec * beatsPerSecond;
        const nextOnsetBeat = i < onsets.length - 1 ? onsets[i + 1]!.timeSec * beatsPerSecond : startBeat + 1;
        const duration = Math.max(minInterval, (nextOnsetBeat - startBeat) * 0.9);
        const velocity = Math.max(1, Math.min(127, Math.round((onset.amplitude / maxAmplitude) * 127)));
        const pitch = mode === 'pitched' && onset.pitch !== undefined ? onset.pitch : targetPitch;

        addMidiNote(midiClip.id, pitch, startBeat, duration, velocity);
    }
}
