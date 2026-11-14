import Meyda from 'meyda';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import * as integratedLoudness from '#/utils/audioMetering/measureIntegratedLoudness';
import * as windowedLoudness from '#/utils/audioMetering/measureMaxWindowedLoudness';
import * as truePeak from '#/utils/audioMetering/measureTruePeak';

import { type AgentObjectiveMetricEntry } from '../../models/AgentObjectiveAnalysisTypes';
import * as spectrum from '../../services/agentObjectiveAnalysis/measureRenderSpectrum';
import * as stereo from '../../services/agentObjectiveAnalysis/measureRenderStereo';
import * as onsets from '../detectOnsets';
import { getAgentMeasurementMetricIds } from '../getAgentMeasurementMetricIds';
import { measureAgentObjectiveBuffer } from '../measureAgentObjectiveBuffer';
import { measureAgentScopeRender } from '../measureAgentScopeRender';
import * as programme from '../referenceMixComparison/analyzeMix/measureProgramAudio';

const SAMPLE_RATE = 48_000;
const TONE_FRAMES = 96_000;
const TONE_HZ = 1000;

type SpectralRequestMetric = 'integratedLoudness' | 'spectralCentroid' | 'frequencyBandEnergy';

function toneBuffer(channels = 2, frames = TONE_FRAMES, sampleRate = SAMPLE_RATE): AudioBuffer {
    const buffer = MockAudioBuffer.create(channels, frames, sampleRate);
    const amplitude = 10 ** (-23 / 20);
    for (let channel = 0; channel < channels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame++) {
            samples[frame] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * frame) / sampleRate);
        }
    }
    return buffer;
}

function fullScopeEntries(full: ReturnType<typeof measureAgentObjectiveBuffer>['measurements']) {
    const onsets = full.onsetTimes;
    let onsetCount: AgentObjectiveMetricEntry;
    if (onsets.status === 'unavailable') {
        onsetCount = onsets;
    } else {
        if (!Array.isArray(onsets.value)) {
            throw new TypeError('Expected the full producer to report onset times as a series.');
        }
        onsetCount = { ...onsets, unit: 'count', value: onsets.value.length };
    }
    return {
        integratedLoudness: full.integratedLoudness,
        shortTermLoudnessMax: full.shortTermLoudnessMax,
        momentaryLoudnessMax: full.momentaryLoudnessMax,
        truePeak: full.truePeak,
        rms: full.rms,
        crestFactor: full.crestFactor,
        dynamicRangeEstimate: full.dynamicRangeEstimate,
        spectralCentroid: full.spectralCentroid,
        spectralRolloff: full.spectralRolloff,
        frequencyBandEnergy: full.frequencyBandEnergy,
        stereoCorrelation: full.stereoCorrelation,
        sideEnergyFraction: full.sideEnergyFraction,
        lowFrequencyStereoContent: full.lowFrequencyStereoContent,
        transientDensity: full.transientDensity,
        onsetCount,
    };
}

function scalar(entry: AgentObjectiveMetricEntry | undefined): number {
    if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
        throw new TypeError('Expected an actual scalar measurement.');
    }
    return entry.value;
}

function observeFamilies() {
    return {
        programme: vi.spyOn(programme, 'measureProgramAudio'),
        onsets: vi.spyOn(onsets, 'detectOnsets'),
        truePeak: vi.spyOn(truePeak, 'measureTruePeak'),
        windowedLoudness: vi.spyOn(windowedLoudness, 'measureMaxWindowedLoudness'),
        stereo: vi.spyOn(stereo, 'measureRenderStereo'),
        spectrum: vi.spyOn(spectrum, 'measureRenderSpectrum'),
        integratedLoudness: vi.spyOn(integratedLoudness, 'measureIntegratedLoudness'),
    };
}

function familyCalls(families: ReturnType<typeof observeFamilies>) {
    return {
        programme: families.programme.mock.calls.length,
        onsets: families.onsets.mock.calls.length,
        truePeak: families.truePeak.mock.calls.length,
        windowedLoudness: families.windowedLoudness.mock.calls.length,
        stereo: families.stereo.mock.calls.length,
        spectrum: families.spectrum.mock.calls.length,
        integratedLoudness: families.integratedLoudness.mock.calls.length,
    };
}

function expectSpectralSelection(input: {
    metrics: SpectralRequestMetric[];
    ordered: SpectralRequestMetric[];
    integratedCalls: number;
}): void {
    const buffer = toneBuffer();
    const originalChannels = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
    const families = observeFamilies();
    const full = measureAgentObjectiveBuffer(buffer).measurements;
    // A real full read proves every call-through observation before resetting only its counts.
    expect(familyCalls(families)).toEqual({
        programme: 1,
        onsets: 1,
        truePeak: 1,
        windowedLoudness: 2,
        stereo: 1,
        spectrum: 1,
        integratedLoudness: 1,
    });
    for (const family of Object.values(families)) {
        family.mockClear();
    }

    const selected = measureAgentScopeRender(buffer, input.metrics);
    expect(Object.keys(selected)).toEqual(input.ordered);
    expect(selected).toEqual(Object.fromEntries(input.ordered.map((id) => [id, full[id]])));
    expect(scalar(selected.spectralCentroid)).toBeCloseTo(TONE_HZ, -1);
    expect(selected.frequencyBandEnergy).toMatchObject({
        status: 'measured',
        value: { mid: expect.closeTo(1, 1) },
    });
    if (input.integratedCalls === 1) {
        expect(scalar(selected.integratedLoudness)).toBeCloseTo(-23, 1);
    }
    expect(buffer.getChannelData(0)).toEqual(originalChannels[0]);
    expect(buffer.getChannelData(1)).toEqual(originalChannels[1]);
    expect(familyCalls(families)).toEqual({
        programme: 0,
        onsets: 0,
        truePeak: 0,
        windowedLoudness: 0,
        stereo: 0,
        spectrum: 1,
        integratedLoudness: input.integratedCalls,
    });
}

describe('measureAgentScopeRender', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('measures the exact spectral subset once without running unrelated families', () => {
        expectSpectralSelection({
            metrics: ['frequencyBandEnergy', 'spectralCentroid', 'frequencyBandEnergy'],
            ordered: ['spectralCentroid', 'frequencyBandEnergy'],
            integratedCalls: 0,
        });
    });

    it('adds real integrated loudness for preview matching without running unrelated families', () => {
        expectSpectralSelection({
            metrics: ['frequencyBandEnergy', 'integratedLoudness', 'spectralCentroid', 'integratedLoudness'],
            ordered: ['integratedLoudness', 'spectralCentroid', 'frequencyBandEnergy'],
            integratedCalls: 1,
        });
    });

    it('keeps silence unavailable at every requested metric', () => {
        const buffer = MockAudioBuffer.create(2, SAMPLE_RATE, SAMPLE_RATE);
        const full = measureAgentObjectiveBuffer(buffer).measurements;
        const selected = measureAgentScopeRender(buffer, [
            'lowFrequencyStereoContent',
            'spectralCentroid',
            'integratedLoudness',
        ]);
        expect(selected).toEqual({
            integratedLoudness: full.integratedLoudness,
            spectralCentroid: full.spectralCentroid,
            lowFrequencyStereoContent: full.lowFrequencyStereoContent,
        });
        expect(Object.values(selected)).toEqual([
            { status: 'unavailable', reason: 'silent' },
            { status: 'unavailable', reason: 'silent' },
            { status: 'unavailable', reason: 'silent' },
        ]);
    });

    it('preserves independent too-short and mono reasons', () => {
        const buffer = toneBuffer(1, 100);
        const full = measureAgentObjectiveBuffer(buffer).measurements;
        const selected = measureAgentScopeRender(buffer, [
            'lowFrequencyStereoContent',
            'spectralCentroid',
            'integratedLoudness',
        ]);
        expect(selected).toEqual({
            integratedLoudness: full.integratedLoudness,
            spectralCentroid: full.spectralCentroid,
            lowFrequencyStereoContent: full.lowFrequencyStereoContent,
        });
        expect(selected).toEqual({
            integratedLoudness: { status: 'unavailable', reason: 'too-short' },
            spectralCentroid: { status: 'unavailable', reason: 'too-short' },
            lowFrequencyStereoContent: { status: 'unavailable', reason: 'mono' },
        });
    });

    it('converts actual onset times to a count with the same confidence', () => {
        const buffer = MockAudioBuffer.create(2, TONE_FRAMES, SAMPLE_RATE);
        const samples = buffer.getChannelData(1);
        for (const start of [24_000, 72_000]) {
            for (let frame = 0; frame < 512; frame++) {
                samples[start + frame] = (1 - frame / 512) * Math.sin((2 * Math.PI * TONE_HZ * frame) / SAMPLE_RATE);
            }
        }
        const original = samples.slice();
        const full = measureAgentObjectiveBuffer(buffer).measurements.onsetTimes;
        if (full.status !== 'measured' || !Array.isArray(full.value)) {
            throw new TypeError('Expected the actual pulse fixture to produce an onset series.');
        }
        expect(full.value.length).toBeGreaterThan(0);
        expect(measureAgentScopeRender(buffer, ['onsetCount', 'onsetCount'])).toEqual({
            onsetCount: {
                status: 'measured',
                metricVersion: 1,
                unit: 'count',
                value: full.value.length,
                confidence: full.confidence,
            },
        });
        expect(samples).toEqual(original);
    });

    it('keeps every scope metric equal to the total producer in canonical order', () => {
        const buffer = toneBuffer();
        const families = observeFamilies();
        const expected = fullScopeEntries(measureAgentObjectiveBuffer(buffer).measurements);
        for (const family of Object.values(families)) {
            family.mockClear();
        }
        const selected = measureAgentScopeRender(buffer, Array.from(getAgentMeasurementMetricIds()).reverse());
        expect(Object.keys(selected)).toEqual(Object.keys(expected));
        expect(selected).toEqual(expected);
        expect(scalar(selected.integratedLoudness)).toBeCloseTo(-23, 1);
        expect(familyCalls(families)).toEqual({
            programme: 1,
            onsets: 1,
            truePeak: 1,
            windowedLoudness: 2,
            stereo: 1,
            spectrum: 1,
            integratedLoudness: 1,
        });
    });

    it('uses the same finite-safe samples for every selected family without changing corrupt PCM', () => {
        const buffer = toneBuffer();
        buffer.getChannelData(0)[31] = Number.NaN;
        buffer.getChannelData(0)[1234] = Number.POSITIVE_INFINITY;
        buffer.getChannelData(1)[543] = Number.NEGATIVE_INFINITY;
        const originals = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
        const expected = fullScopeEntries(measureAgentObjectiveBuffer(buffer).measurements);
        const selected = measureAgentScopeRender(buffer, getAgentMeasurementMetricIds());
        expect(selected).toEqual(expected);
        expect(Object.keys(selected)).toEqual(Object.keys(expected));
        expect(Number.isFinite(scalar(selected.integratedLoudness))).toBe(true);
        expect(Number.isFinite(scalar(selected.spectralCentroid))).toBe(true);
        expect(buffer.getChannelData(0)).toEqual(originals[0]);
        expect(buffer.getChannelData(1)).toEqual(originals[1]);
        expect(Number.isNaN(buffer.getChannelData(0)[31])).toBe(true);
        expect(buffer.getChannelData(0)[1234]).toBe(Number.POSITIVE_INFINITY);
        expect(buffer.getChannelData(1)[543]).toBe(Number.NEGATIVE_INFINITY);
    });

    it('isolates mixed family requests and sample rates without leaking shared analyzer settings', () => {
        const first = toneBuffer();
        const second = toneBuffer(1, 44_100, 22_050);
        const settings = { sampleRate: Meyda.sampleRate, bufferSize: Meyda.bufferSize };
        const firstExpected = fullScopeEntries(measureAgentObjectiveBuffer(first).measurements);
        const secondExpected = fullScopeEntries(measureAgentObjectiveBuffer(second).measurements);
        const requests: Array<{
            buffer: AudioBuffer;
            metrics: Parameters<typeof measureAgentScopeRender>[1];
            expected: ReturnType<typeof fullScopeEntries>;
        }> = [
            { buffer: first, metrics: ['frequencyBandEnergy', 'spectralCentroid'], expected: firstExpected },
            { buffer: second, metrics: ['onsetCount', 'integratedLoudness'], expected: secondExpected },
            { buffer: first, metrics: ['lowFrequencyStereoContent', 'stereoCorrelation'], expected: firstExpected },
            { buffer: second, metrics: getAgentMeasurementMetricIds(), expected: secondExpected },
            { buffer: first, metrics: getAgentMeasurementMetricIds(), expected: firstExpected },
        ];
        for (const request of requests) {
            const selected = measureAgentScopeRender(request.buffer, request.metrics);
            const ids = getAgentMeasurementMetricIds().filter((id) => request.metrics.includes(id));
            expect(selected).toEqual(Object.fromEntries(ids.map((id) => [id, request.expected[id]])));
            expect(Object.keys(selected)).toEqual(ids);
            expect(Meyda.sampleRate).toBe(settings.sampleRate);
            expect(Meyda.bufferSize).toBe(settings.bufferSize);
        }
    });
});
