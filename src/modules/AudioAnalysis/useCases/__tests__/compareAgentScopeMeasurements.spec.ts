import { describe, expect, it } from 'vitest';

import { compareAgentScopeMeasurements } from '../compareAgentScopeMeasurements';

type Entry = NonNullable<Parameters<typeof compareAgentScopeMeasurements>[0]['baseline']['integratedLoudness']>;

function measured(value: number | Readonly<Record<string, number>>, unit: 'LUFS' | 'dBTP' | 'dBFS' | 'dB'): Entry {
    return { status: 'measured', metricVersion: 1, unit, value, confidence: 'exact' };
}

const SILENT: Entry = { status: 'unavailable', reason: 'silent' };
const BANDS = { low: -12, mid: -18, high: -24 };

describe('compareAgentScopeMeasurements', () => {
    it('gives each scalar metric a signed preview − baseline delta in its unit, and every other metric a typed reason', () => {
        const deltas = compareAgentScopeMeasurements({
            baseline: {
                integratedLoudness: measured(-14, 'LUFS'),
                truePeak: measured(-1, 'dBTP'),
                rms: SILENT,
                frequencyBandEnergy: measured(BANDS, 'dB'),
            },
            preview: {
                integratedLoudness: measured(-20, 'LUFS'),
                truePeak: measured(-3.5, 'dBTP'),
                rms: measured(-20, 'dBFS'),
                frequencyBandEnergy: measured({ ...BANDS, low: -6 }, 'dB'),
            },
        });

        expect(deltas).toEqual({
            integratedLoudness: { status: 'compared', delta: -6, unit: 'LU' },
            truePeak: { status: 'compared', delta: -2.5, unit: 'dB' },
            rms: { status: 'incomparable', reason: 'baseline-unavailable' },
            frequencyBandEnergy: { status: 'incomparable', reason: 'non-scalar' },
        });
    });

    it('names the preview side when the preview could not measure a metric the baseline did', () => {
        const deltas = compareAgentScopeMeasurements({
            baseline: { integratedLoudness: measured(-14, 'LUFS') },
            preview: { integratedLoudness: SILENT },
        });

        expect(deltas).toEqual({ integratedLoudness: { status: 'incomparable', reason: 'candidate-unavailable' } });
    });

    it('treats a metric only one side reports as unavailable on the other, and omits a metric neither reports', () => {
        const deltas = compareAgentScopeMeasurements({
            baseline: { rms: measured(-20, 'dBFS') },
            preview: { truePeak: measured(-1, 'dBTP') },
        });

        expect(deltas).toEqual({
            truePeak: { status: 'incomparable', reason: 'baseline-unavailable' },
            rms: { status: 'incomparable', reason: 'candidate-unavailable' },
        });
        expect(deltas).not.toHaveProperty('integratedLoudness');
    });

    it('keys the deltas in the measure tool’s metric order', () => {
        const deltas = compareAgentScopeMeasurements({
            baseline: { rms: measured(-20, 'dBFS'), integratedLoudness: measured(-14, 'LUFS') },
            preview: { rms: measured(-21, 'dBFS'), integratedLoudness: measured(-15, 'LUFS') },
        });

        expect(Object.keys(deltas)).toEqual(['integratedLoudness', 'rms']);
    });
});
