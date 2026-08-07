import { describe, expect, it } from 'vitest';

import {
    DEFAULT_MACRO_MAPPINGS,
    DEFAULT_PATCH,
    ENGINE_NAMES,
    FERMENTER_PARAMS,
    FILTER_MODE_NAMES,
    FILTER_MODEL_NAMES,
    FM_ALGORITHM_NAMES,
    LFO_SHAPE_NAMES,
    MACRO_LABELS,
    NOISE_COLOR_NAMES,
    WARP_MODE_NAMES,
    WAVEFORM_NAMES,
} from '../FermenterPatch';

describe('FermenterPatch constants', () => {
    it('DEFAULT_PATCH has the expected shape and version', () => {
        expect(DEFAULT_PATCH.version).toBe(1);
        expect(typeof DEFAULT_PATCH.name).toBe('string');
        expect(DEFAULT_PATCH.oscEngine).toBeGreaterThanOrEqual(0);
        expect(DEFAULT_PATCH.oscEngine).toBeLessThan(ENGINE_NAMES.length);
    });

    it('ENGINE_NAMES has 7 entries matching the oscEngine range', () => {
        expect(ENGINE_NAMES).toHaveLength(7);
        expect(ENGINE_NAMES).toContain('Wavetable');
        expect(ENGINE_NAMES).toContain('FM');
        expect(ENGINE_NAMES).toContain('Sampler');
    });

    it('WAVEFORM_NAMES has 4 entries', () => {
        expect(WAVEFORM_NAMES).toHaveLength(4);
        expect(WAVEFORM_NAMES).toEqual(['Sine', 'Saw', 'Square', 'Triangle']);
    });

    it('FILTER_MODE_NAMES has 4 entries', () => {
        expect(FILTER_MODE_NAMES).toHaveLength(4);
        expect(FILTER_MODE_NAMES).toContain('Low Pass');
    });

    it('FILTER_MODEL_NAMES has entries', () => {
        expect(FILTER_MODEL_NAMES.length).toBeGreaterThan(0);
    });

    it('FM_ALGORITHM_NAMES has entries', () => {
        expect(FM_ALGORITHM_NAMES.length).toBeGreaterThan(0);
    });

    it('LFO_SHAPE_NAMES has 4 entries', () => {
        expect(LFO_SHAPE_NAMES).toHaveLength(4);
    });

    it('NOISE_COLOR_NAMES has 3 entries', () => {
        expect(NOISE_COLOR_NAMES).toEqual(['White', 'Pink', 'Brown']);
    });

    it('WARP_MODE_NAMES has 7 entries', () => {
        expect(WARP_MODE_NAMES).toHaveLength(7);
    });

    it('MACRO_LABELS has 8 entries', () => {
        expect(MACRO_LABELS.length).toBe(8);
        expect(MACRO_LABELS).toContain('Brightness');
    });
});

describe('FermenterPatch — DEFAULT_MACRO_MAPPINGS', () => {
    it('has 8 macro mappings', () => {
        expect(DEFAULT_MACRO_MAPPINGS).toHaveLength(8);
    });

    it('each mapping has a targets array', () => {
        for (const mapping of DEFAULT_MACRO_MAPPINGS) {
            expect(Array.isArray(mapping.targets)).toBe(true);
        }
    });
});

describe('FermenterPatch — FERMENTER_PARAMS', () => {
    it('has parameter definitions with required fields', () => {
        expect(FERMENTER_PARAMS.length).toBeGreaterThan(20);
        for (const param of FERMENTER_PARAMS) {
            expect(typeof param.id).toBe('string');
            expect(param.id.length).toBeGreaterThan(0);
        }
    });
});
