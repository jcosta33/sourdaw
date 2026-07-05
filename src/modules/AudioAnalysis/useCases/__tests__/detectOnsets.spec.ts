import { describe, it, expect } from 'vitest';

import { detectOnsets } from '../detectOnsets';

const SAMPLE_RATE = 44100;
const HOP_SIZE = 512;
const FRAME_SIZE = 1024;

/**
 * Build a mono AudioBuffer-like object. `fill(index)` returns the sample value at
 * `index`; `length` defines the clip length in samples.
 */
function makeBuffer(length: number, fill: (index: number) => number): AudioBuffer {
    const data = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        data[index] = fill(index);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 1,
        duration: length / SAMPLE_RATE,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

/** RMS energy of the FRAME_SIZE window starting at frame `frame` — independent of the
 *  implementation under test, used to derive ground-truth amplitudes. */
function frameRms(buffer: AudioBuffer, frame: number): number {
    const data = buffer.getChannelData(0);
    const start = frame * HOP_SIZE;
    const end = Math.min(start + FRAME_SIZE, data.length);
    let sum = 0;
    for (let index = start; index < end; index++) {
        sum += data[index]! * data[index]!;
    }
    return Math.sqrt(sum / (end - start));
}

/**
 * Re-derive, from the raw buffer alone, the frame index at which `detectOnsets` reports
 * its first onset — replicating the spectral-flux peak-picking but NOT the timestamp /
 * amplitude indexing under test. This gives an independent ground truth so the timing
 * assertions cannot be satisfied tautologically by the implementation's own output.
 * Returns -1 if no onset frame qualifies.
 */
function expectedPeakFluxFrame(buffer: AudioBuffer, sensitivity: number): number {
    const data = buffer.getChannelData(0);
    const numFrames = Math.floor((data.length - FRAME_SIZE) / HOP_SIZE) + 1;
    if (numFrames < 2) {
        return -1;
    }

    const energies: number[] = [];
    for (let index = 0; index < numFrames; index++) {
        energies.push(frameRms(buffer, index));
    }

    const flux: number[] = [];
    let maxFlux = 0;
    for (let index = 0; index < numFrames - 1; index++) {
        const value = Math.max(0, energies[index + 1]! - energies[index]!);
        flux.push(value);
        if (value > maxFlux) {
            maxFlux = value;
        }
    }
    if (maxFlux < 1e-8) {
        return -1;
    }

    const threshold = sensitivity * maxFlux;
    for (let index = 1; index < flux.length - 1; index++) {
        if (flux[index]! > threshold && flux[index]! > flux[index - 1]! && flux[index]! >= flux[index + 1]!) {
            return index;
        }
    }
    return -1;
}

function onsetFrames(onsets: ReturnType<typeof detectOnsets>): number[] {
    return onsets.map((onset) => Math.round((onset.timeSec * SAMPLE_RATE) / HOP_SIZE));
}

describe('detectOnsets onset timing (Fix 2: one-hop lag)', () => {
    it('reports the onset at the flux-peak frame, not one hop later', () => {
        // Silence, then a sustained loud region beginning at a known frame boundary far
        // from both edges so the energy rise (and thus the flux peak) is unambiguous.
        const onsetFrame = 20;
        const onsetSample = onsetFrame * HOP_SIZE;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => (index >= onsetSample ? 0.8 : 0));

        const onsets = detectOnsets(buffer, 0.3, 0.001);

        expect(onsets.length).toBeGreaterThan(0);
        const reported = onsets[0]!.timeSec;

        // Ground truth derived *independently* from the buffer (not from the reported
        // value): the frame index where detectOnsets peaks. The fix timestamps the onset
        // at `peakFrame * HOP/sr`; the buggy version added one extra hop.
        const peakFrame = expectedPeakFluxFrame(buffer, 0.3);
        expect(peakFrame).toBeGreaterThan(0);

        const fixedTime = (peakFrame * HOP_SIZE) / SAMPLE_RATE;
        const buggyTime = ((peakFrame + 1) * HOP_SIZE) / SAMPLE_RATE;

        expect(reported).toBeCloseTo(fixedTime, 9);
        expect(reported).not.toBeCloseTo(buggyTime, 9);
    });

    it('reads amplitude from the flux-peak frame, not the frame after it', () => {
        // Silence, then a sustained loud region: the flux-peak frame (still partly inside
        // the rising edge) and the frame after it (fully loud) have *different* RMS
        // energies, so reading the wrong (next) frame yields a measurably different
        // amplitude. Both the peak frame and its successor are derived independently from
        // the buffer.
        const riseSample = 24 * HOP_SIZE;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => (index >= riseSample ? 0.7 : 0));

        const onsets = detectOnsets(buffer, 0.3, 0.001);
        expect(onsets.length).toBeGreaterThan(0);

        const peakFrame = expectedPeakFluxFrame(buffer, 0.3);
        expect(peakFrame).toBeGreaterThan(0);
        const peakEnergy = frameRms(buffer, peakFrame);
        const nextEnergy = frameRms(buffer, peakFrame + 1);

        // Sanity: the two frames really do differ, so the assertion can discriminate
        // between reading the peak frame (fix) and the next frame (bug).
        expect(Math.abs(peakEnergy - nextEnergy)).toBeGreaterThan(1e-6);
        expect(onsets[0]!.amplitude).toBeCloseTo(peakEnergy, 6);
        expect(onsets[0]!.amplitude).not.toBeCloseTo(nextEnergy, 6);
    });
});

describe('detectOnsets detection gates', () => {
    it('should return no onsets for a buffer with fewer than two analysis frames', () => {
        const buffer = makeBuffer(FRAME_SIZE, () => 0.8);

        const onsets = detectOnsets(buffer, 0.3, 0.001);

        expect(onsets).toEqual([]);
    });

    it('should return no onsets for silent or flat no-flux buffers', () => {
        const length = 20 * HOP_SIZE + FRAME_SIZE;
        const silentBuffer = makeBuffer(length, () => 0);
        const flatBuffer = makeBuffer(length, () => 0.4);

        expect(detectOnsets(silentBuffer, 0.3, 0.001)).toEqual([]);
        expect(detectOnsets(flatBuffer, 0.3, 0.001)).toEqual([]);
    });

    it('should suppress close onsets inside the minimum interval', () => {
        const firstStepFrame = 20;
        const secondStepFrame = 24;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => {
            if (index >= secondStepFrame * HOP_SIZE) {
                return 0.9;
            }
            if (index >= firstStepFrame * HOP_SIZE) {
                return 0.35;
            }
            return 0;
        });

        const looseOnsetFrames = onsetFrames(detectOnsets(buffer, 0.2, 0.001));
        expect(looseOnsetFrames).toHaveLength(2);

        const minimumIntervalSec = (6 * HOP_SIZE) / SAMPLE_RATE;
        const gatedOnsetFrames = onsetFrames(detectOnsets(buffer, 0.2, minimumIntervalSec));

        expect(looseOnsetFrames[1]! - looseOnsetFrames[0]!).toBeLessThan(6);
        expect(gatedOnsetFrames).toEqual([looseOnsetFrames[0]]);
    });

    it('should use sensitivity to reject lower-flux peaks', () => {
        const firstStepFrame = 20;
        const secondStepFrame = 30;
        const length = 80 * HOP_SIZE + FRAME_SIZE;
        const buffer = makeBuffer(length, (index) => {
            if (index >= secondStepFrame * HOP_SIZE) {
                return 0.5;
            }
            if (index >= firstStepFrame * HOP_SIZE) {
                return 0.4;
            }
            return 0;
        });

        const lowSensitivityFrames = onsetFrames(detectOnsets(buffer, 0.1, 0.001));
        const highSensitivityFrames = onsetFrames(detectOnsets(buffer, 0.8, 0.001));

        expect(lowSensitivityFrames).toHaveLength(2);
        expect(highSensitivityFrames).toEqual([lowSensitivityFrames[0]]);
    });
});
