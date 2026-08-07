import { describe, expect, it } from 'vitest';

import { EXPANDED_FX_PRESETS, EXPANDED_SYNTH_PRESETS } from '../expandedPresets';

describe('expandedPresets', () => {
    it('exports FX and synth preset arrays', () => {
        expect(EXPANDED_FX_PRESETS.length).toBeGreaterThan(0);
        expect(EXPANDED_SYNTH_PRESETS.length).toBeGreaterThan(0);
    });

    it('all FX presets have unique ids', () => {
        const ids = new Set<string>();
        for (const preset of EXPANDED_FX_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('all synth presets have unique ids', () => {
        const ids = new Set<string>();
        for (const preset of EXPANDED_SYNTH_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(ids.has(preset.id)).toBe(false);
            ids.add(preset.id);
        }
    });

    it('no id collision between FX and synth presets', () => {
        const fxIds = new Set(EXPANDED_FX_PRESETS.map((p) => p.id));
        for (const synthPreset of EXPANDED_SYNTH_PRESETS) {
            expect(fxIds.has(synthPreset.id)).toBe(false);
        }
    });

    it('every preset has a non-empty name', () => {
        for (const preset of [...EXPANDED_FX_PRESETS, ...EXPANDED_SYNTH_PRESETS]) {
            expect(preset.name).toBeTruthy();
        }
    });

    it('every preset has a valid trackKind', () => {
        const validKinds = new Set(['audio', 'midi']);
        for (const preset of [...EXPANDED_FX_PRESETS, ...EXPANDED_SYNTH_PRESETS]) {
            expect(validKinds.has(preset.trackKind)).toBe(true);
        }
    });

    it('every preset has at least one device', () => {
        for (const preset of [...EXPANDED_FX_PRESETS, ...EXPANDED_SYNTH_PRESETS]) {
            expect(preset.devices.length).toBeGreaterThan(0);
        }
    });

    it('every device has a type and parameterValues', () => {
        for (const preset of [...EXPANDED_FX_PRESETS, ...EXPANDED_SYNTH_PRESETS]) {
            for (const device of preset.devices) {
                expect(device.type).toBeTruthy();
                expect(typeof device.parameterValues).toBe('object');
            }
        }
    });

    it('FX presets have audio trackKind', () => {
        for (const preset of EXPANDED_FX_PRESETS) {
            expect(preset.trackKind).toBe('audio');
        }
    });

    it('synth presets have midi trackKind', () => {
        for (const preset of EXPANDED_SYNTH_PRESETS) {
            expect(preset.trackKind).toBe('midi');
        }
    });
});
