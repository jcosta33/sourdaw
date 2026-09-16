import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type AgentObjectiveAnalysisReceipt,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type MeasuredAgentObjectiveAnalysisReceipt,
} from '../../models/AgentObjectiveAnalysisTypes';
import { analyzeAgentRenderReceipt } from '../analyzeAgentRenderReceipt';

const mocks = vi.hoisted(() => ({ getExactAgentSectionRenderArtifact: vi.fn() }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getExactAgentSectionRenderArtifact: mocks.getExactAgentSectionRenderArtifact,
}));

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;
const CONTENT_ADDRESS = 'content-address-candidate';
const SOURCE_REVISION = 'revision-7';

const JOB = {
    jobId: 'job-1',
    sectionId: 'section-1',
    sectionName: 'Chorus',
    startBeat: 0,
    endBeat: 16,
    sampleRate: SAMPLE_RATE,
    tailSeconds: 0.5,
};

/**
 * The order every receipt reports its metrics in. Written out here rather than
 * imported so a receipt that quietly drops or reorders a metric fails, instead
 * of agreeing with whatever the production list happens to say.
 */
const EXPECTED_METRIC_IDS = [
    'samplePeak',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'momentaryLoudnessMax',
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'dcOffset',
    'clippingCount',
    'silentFraction',
    'tailTruncation',
    'spectralCentroid',
    'spectralRolloff',
    'frequencyBandEnergy',
    'stereoCorrelation',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'transientDensity',
    'onsetTimes',
    'tempoAlignment',
    'phasePolarity',
    'interTrackMasking',
    'busHeadroom',
    'gainStagingAnomalies',
];

/**
 * A 1 kHz sine at a given dBFS peak. BS.1770 is calibrated so a stereo 1 kHz
 * sine reads its own peak level in LUFS, which is what lets these expectations
 * be absolute figures rather than comparisons against the code's own output.
 */
function sineChannel(peakDbfs: number, length: number): Float32Array {
    const amplitude = 10 ** (peakDbfs / 20);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        samples[index] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE);
    }
    return samples;
}

function invert(channel: Float32Array): Float32Array {
    return channel.map((sample) => -sample);
}

function constantChannel(value: number, length: number): Float32Array {
    return new Float32Array(length).fill(value);
}

function clickChannel(length: number, clickFrames: readonly number[]): Float32Array {
    const samples = new Float32Array(length);
    for (const frame of clickFrames) {
        samples[frame] = 0.9;
    }
    return samples;
}

function audioBuffer(channelData: readonly Float32Array[]): AudioBuffer {
    const length = channelData[0]?.length ?? 0;
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: channelData.length,
        duration: length / SAMPLE_RATE,
        getChannelData: (channel: number) => channelData[channel] ?? new Float32Array(length),
    } as unknown as AudioBuffer;
}

function retainArtifact(channelData: readonly Float32Array[], contentAddress = CONTENT_ADDRESS): void {
    const buffer = audioBuffer(channelData);
    mocks.getExactAgentSectionRenderArtifact.mockReturnValue({
        ...JOB,
        sourceRevision: SOURCE_REVISION,
        owner: 'agent-section-render',
        retention: 'session',
        renderedAt: 1_700_000_000_000,
        durationSeconds: buffer.length / SAMPLE_RATE,
        frameCount: buffer.length,
        channelCount: channelData.length,
        byteSize: buffer.length * channelData.length * 4,
        contentAddress,
        warnings: [],
        buffer,
    });
}

function analyze(
    channelData: readonly Float32Array[],
    options: { baseline?: MeasuredAgentObjectiveAnalysisReceipt; requestedContentAddress?: string } = {}
): AgentObjectiveAnalysisReceipt {
    retainArtifact(channelData);
    return analyzeAgentRenderReceipt({
        subject: {
            job: JOB,
            sourceRevision: SOURCE_REVISION,
            contentAddress: options.requestedContentAddress ?? CONTENT_ADDRESS,
        },
        baseline: options.baseline,
    });
}

function measuredReceipt(receipt: AgentObjectiveAnalysisReceipt): MeasuredAgentObjectiveAnalysisReceipt {
    if (receipt.status !== 'measured') {
        throw new Error(`Expected a measured receipt, got unavailable (${receipt.reason})`);
    }
    return receipt;
}

function entry(receipt: AgentObjectiveAnalysisReceipt, id: AgentObjectiveMetricId): AgentObjectiveMetricEntry {
    return measuredReceipt(receipt).measurements[id];
}

function metric(receipt: AgentObjectiveAnalysisReceipt, id: AgentObjectiveMetricId): number {
    const found = entry(receipt, id);
    if (found.status !== 'measured') {
        throw new Error(`Expected ${id} to be measured, got unavailable (${found.reason})`);
    }
    if (typeof found.value !== 'number') {
        throw new TypeError(`Expected ${id} to be a scalar`);
    }
    return found.value;
}

beforeEach(() => {
    mocks.getExactAgentSectionRenderArtifact.mockReset();
});

describe('analyzeAgentRenderReceipt — refusals', () => {
    it('refuses when no retained artifact matches the job and revision', () => {
        mocks.getExactAgentSectionRenderArtifact.mockReturnValue(null);

        expect(
            analyzeAgentRenderReceipt({
                subject: { job: JOB, sourceRevision: SOURCE_REVISION, contentAddress: CONTENT_ADDRESS },
            })
        ).toEqual({ status: 'unavailable', reason: 'no-retained-artifact' });
    });

    it('refuses when the retained artifact is not the audio the caller named', () => {
        const receipt = analyze([sineChannel(-23, SAMPLE_RATE), sineChannel(-23, SAMPLE_RATE)], {
            requestedContentAddress: 'content-address-of-some-other-render',
        });

        expect(receipt).toEqual({ status: 'unavailable', reason: 'content-address-mismatch' });
    });
});

describe('analyzeAgentRenderReceipt — level, loudness and spectral measurements', () => {
    it('reads a -23 dBFS stereo sine as the figures a calibrated meter shows', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(metric(receipt, 'integratedLoudness')).toBeCloseTo(-23, 1);
        expect(metric(receipt, 'momentaryLoudnessMax')).toBeCloseTo(-23, 1);
        expect(metric(receipt, 'shortTermLoudnessMax')).toBeCloseTo(-23, 1);
        expect(Math.abs(metric(receipt, 'samplePeak') - -23)).toBeLessThan(0.01);
        expect(Math.abs(metric(receipt, 'rms') - -26.01)).toBeLessThan(0.02);
        expect(Math.abs(metric(receipt, 'crestFactor') - 3.01)).toBeLessThan(0.02);
        expect(Math.abs(metric(receipt, 'stereoCorrelation') - 1)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'sideEnergyFraction'))).toBeLessThan(1e-6);
        expect(metric(receipt, 'dcOffset')).toBeLessThan(1e-4);
        expect(metric(receipt, 'clippingCount')).toBe(0);
        expect(metric(receipt, 'silentFraction')).toBe(0);
        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
    });

    it('reports spectral rolloff in hertz, not in bins', () => {
        // meyda returns the centroid as a bin index and the rolloff already in
        // hertz. Converting the rolloff as if it were a bin puts a 1 kHz tone
        // near 25 kHz — above Nyquist for this render.
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(metric(receipt, 'spectralRolloff')).toBeGreaterThan(900);
        expect(metric(receipt, 'spectralRolloff')).toBeLessThan(1500);
    });

    it('reads a polarity-inverted channel as fully out of phase', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, invert(tone)]);

        expect(Math.abs(metric(receipt, 'stereoCorrelation') - -1)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'sideEnergyFraction') - 1)).toBeLessThan(1e-6);
    });

    it('reads a single loud channel 3 dB below the same tone in both', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, new Float32Array(SAMPLE_RATE * 2)]);

        expect(metric(receipt, 'integratedLoudness')).toBeCloseTo(-26, 1);
    });

    it('measures a DC offset rather than hiding it in the level', () => {
        const receipt = analyze([constantChannel(0.5, SAMPLE_RATE * 2), constantChannel(0.5, SAMPLE_RATE * 2)]);

        expect(Math.abs(metric(receipt, 'dcOffset') - 0.5)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'samplePeak') - -6.02)).toBeLessThan(0.01);
    });

    it('counts every sample pinned at full scale', () => {
        const clipped = sineChannel(-23, SAMPLE_RATE * 2);
        for (let index = 1000; index < 2000; index++) {
            clipped[index] = 1;
        }
        const receipt = analyze([clipped, sineChannel(-23, SAMPLE_RATE * 2)]);

        expect(metric(receipt, 'clippingCount')).toBe(1000);
    });

    it('reports silence as silence instead of measuring -inf dBFS', () => {
        const silence = new Float32Array(SAMPLE_RATE);
        const receipt = analyze([silence, silence]);

        expect(entry(receipt, 'integratedLoudness')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'samplePeak')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'stereoCorrelation')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(metric(receipt, 'silentFraction')).toBe(1);
        expect(metric(receipt, 'clippingCount')).toBe(0);
    });

    it('reports material too short to gate as too short, not as silent', () => {
        const fragment = sineChannel(-23, 100);
        const receipt = analyze([fragment, fragment]);

        expect(entry(receipt, 'integratedLoudness')).toEqual({ status: 'unavailable', reason: 'too-short' });
    });

    it('has no stereo relationship to report for a mono render', () => {
        const receipt = analyze([sineChannel(-23, SAMPLE_RATE * 2)]);

        expect(entry(receipt, 'stereoCorrelation')).toEqual({ status: 'unavailable', reason: 'mono' });
        expect(entry(receipt, 'sideEnergyFraction')).toEqual({ status: 'unavailable', reason: 'mono' });
    });
});

describe('analyzeAgentRenderReceipt — transients', () => {
    it('places onsets on the samples that actually attack', () => {
        const length = SAMPLE_RATE * 2;
        const clicks = clickChannel(length, [SAMPLE_RATE / 2, (SAMPLE_RATE * 3) / 2]);
        const receipt = analyze([clicks, clicks]);

        // The flux detector fires on the frame whose energy rose, which is one
        // window (about 31 ms here) before the click itself.
        expect(entry(receipt, 'onsetTimes')).toEqual({
            status: 'measured',
            metricVersion: 1,
            unit: 'seconds',
            confidence: 'estimated',
            value: [expect.closeTo(0.5, 2), expect.closeTo(1.5, 2)],
        });
        expect(Math.abs(metric(receipt, 'transientDensity') - 1)).toBeLessThan(0.05);
    });
});

describe('analyzeAgentRenderReceipt — comparison against a baseline receipt', () => {
    it('subtracts scalars, names loudness deltas in LU, and refuses the rest', () => {
        const quiet = sineChannel(-23, SAMPLE_RATE * 2);
        const baseline = measuredReceipt(analyze([quiet, quiet]));
        const loud = sineChannel(-20, SAMPLE_RATE * 2);
        const candidate = measuredReceipt(analyze([loud, loud], { baseline }));

        const comparison = candidate.comparison;
        if (!comparison) {
            throw new Error('Expected a comparison against the baseline receipt');
        }
        expect(comparison.baseline).toEqual({
            contentAddress: CONTENT_ADDRESS,
            sourceRevision: SOURCE_REVISION,
        });
        expect(comparison.metrics.integratedLoudness).toEqual({
            status: 'compared',
            delta: expect.closeTo(3, 1),
            unit: 'LU',
        });
        expect(comparison.metrics.samplePeak).toEqual({
            status: 'compared',
            delta: expect.closeTo(3, 2),
            unit: 'dB',
        });
        expect(comparison.metrics.onsetTimes).toEqual({ status: 'incomparable', reason: 'non-scalar' });
        expect(comparison.metrics.tempoAlignment).toEqual({
            status: 'incomparable',
            reason: 'candidate-unavailable',
        });
    });

    it('refuses to compare a baseline written against another schema version', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const baseline = measuredReceipt(analyze([tone, tone]));
        const futureBaseline = { ...baseline, schemaVersion: 2 } as unknown as MeasuredAgentObjectiveAnalysisReceipt;

        const receipt = measuredReceipt(analyze([tone, tone], { baseline: futureBaseline }));

        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toHaveLength(1);
    });

    it('carries no comparison and no warning when no baseline was supplied', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = measuredReceipt(analyze([tone, tone]));

        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toEqual([]);
    });
});

describe('analyzeAgentRenderReceipt — receipt shape', () => {
    it('binds the receipt to the render it read and reports every metric id', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = measuredReceipt(analyze([tone, tone]));

        expect(receipt.schemaVersion).toBe(1);
        expect(receipt.subject.contentAddress).toBe(CONTENT_ADDRESS);
        expect(receipt.subject.sourceRevision).toBe(SOURCE_REVISION);
        expect(receipt.subject.jobId).toBe(JOB.jobId);
        expect(receipt.subject.sectionName).toBe(JOB.sectionName);
        expect(receipt.subject.frameCount).toBe(SAMPLE_RATE * 2);
        expect(receipt.subject.channelCount).toBe(2);
        expect(Object.keys(receipt.measurements)).toEqual(EXPECTED_METRIC_IDS);
        expect(Date.parse(receipt.analyzedAt)).not.toBeNaN();
    });

    it('types what it cannot measure instead of estimating it', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(entry(receipt, 'lowFrequencyStereoContent')).toEqual({
            status: 'unavailable',
            reason: 'not-implemented',
        });
        expect(entry(receipt, 'phasePolarity')).toEqual({ status: 'unavailable', reason: 'needs-multitrack' });
        expect(entry(receipt, 'interTrackMasking')).toEqual({ status: 'unavailable', reason: 'needs-multitrack' });
        expect(entry(receipt, 'busHeadroom')).toEqual({ status: 'unavailable', reason: 'needs-project-state' });
        expect(entry(receipt, 'gainStagingAnomalies')).toEqual({
            status: 'unavailable',
            reason: 'needs-project-state',
        });
    });
});
