import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../getLevainProjectParameterId', () => ({
    getLevainProjectParameterId: vi.fn((name: string) => `levain.${name}`),
}));

import { createDefaultPatch } from '../../models/LevainPatch';
import { hydrateLevainPatchFromParameterValues } from '../hydrateLevainPatchFromParameterValues';

const DEFAULT_PATCH = createDefaultPatch();

beforeEach(() => {
    vi.clearAllMocks();
});

describe('hydrateLevainPatchFromParameterValues — fallback when no parameterValues', () => {
    it('returns patch unchanged when parameterValues is empty', () => {
        const result = hydrateLevainPatchFromParameterValues({ parameterValues: {}, patch: DEFAULT_PATCH });
        expect(result.masterGain).toBe(DEFAULT_PATCH.masterGain);
        expect(result.legato.enabled).toBe(DEFAULT_PATCH.legato.enabled);
        expect(result.humanize.amount).toBe(DEFAULT_PATCH.humanize.amount);
    });
});

describe('hydrateLevainPatchFromParameterValues — reads from parameterValues', () => {
    it('reads master_gain from parameterValues', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { master_gain: 1.5 },
            patch: DEFAULT_PATCH,
        });
        expect(result.masterGain).toBe(1.5);
    });

    it('clamps master_gain to [0, 2]', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { master_gain: 5 },
            patch: DEFAULT_PATCH,
        });
        expect(result.masterGain).toBe(2);
    });

    it('reads legato_slow_threshold_ms', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { legato_slow_threshold_ms: 400 },
            patch: DEFAULT_PATCH,
        });
        expect(result.legato.slowThresholdMs).toBe(400);
    });

    it('reads humanize_amount', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { humanize_amount: 0.7 },
            patch: DEFAULT_PATCH,
        });
        expect(result.humanize.amount).toBe(0.7);
    });

    it('reads expression_vibrato_rate_min and clamps to [2, 7]', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { expression_vibrato_rate_min: 1 },
            patch: DEFAULT_PATCH,
        });
        expect(result.expression.vibratoRateMin).toBe(2);
    });

    it('ignores non-finite values', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { master_gain: Number.NaN },
            patch: DEFAULT_PATCH,
        });
        expect(result.masterGain).toBe(DEFAULT_PATCH.masterGain);
    });
});

describe('hydrateLevainPatchFromParameterValues — boolean fields', () => {
    it('enables legato when value > 0.5', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { legato_enabled: 1 },
            patch: { ...DEFAULT_PATCH, legato: { ...DEFAULT_PATCH.legato, enabled: false } },
        });
        expect(result.legato.enabled).toBe(true);
    });

    it('disables legato when value <= 0.5', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { legato_enabled: 0 },
            patch: { ...DEFAULT_PATCH, legato: { ...DEFAULT_PATCH.legato, enabled: true } },
        });
        expect(result.legato.enabled).toBe(false);
    });
});

describe('hydrateLevainPatchFromParameterValues — micPositions', () => {
    it('reads mic_0_volume and mic_0_pan', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { mic_0_volume: 0.9, mic_0_pan: -0.5 },
            patch: DEFAULT_PATCH,
        });
        expect(result.micPositions[0]!.volume).toBe(0.9);
        expect(result.micPositions[0]!.pan).toBe(-0.5);
    });

    it('enables/disables mic based on threshold', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { mic_0_enabled: 0 },
            patch: DEFAULT_PATCH,
        });
        expect(result.micPositions[0]!.enabled).toBe(false);
    });
});

describe('hydrateLevainPatchFromParameterValues — vibrato rate min/max ordering', () => {
    it('swaps vibratoRateMin and vibratoRateMax if min > max', () => {
        const result = hydrateLevainPatchFromParameterValues({
            parameterValues: { expression_vibrato_rate_min: 7, expression_vibrato_rate_max: 3 },
            patch: DEFAULT_PATCH,
        });
        // After clamping: min=7 (clamped from original), max=3 → swapped: min=3, max=7
        expect(result.expression.vibratoRateMin).toBeLessThanOrEqual(result.expression.vibratoRateMax);
    });
});
