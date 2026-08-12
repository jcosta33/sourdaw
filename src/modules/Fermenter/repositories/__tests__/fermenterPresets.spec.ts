import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../../models/FermenterPatch';
import { FERMENTER_PRESETS } from '../fermenterPresets';

describe('FERMENTER_PRESETS', () => {
    it('should give every preset a unique id prefixed with fermenter-', () => {
        expect(FERMENTER_PRESETS.length).toBeGreaterThan(0);

        for (const preset of FERMENTER_PRESETS) {
            expect(preset.id.startsWith('fermenter-')).toBe(true);
        }

        const ids = FERMENTER_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should emit exactly one fermenter device per preset, named after the preset', () => {
        for (const preset of FERMENTER_PRESETS) {
            expect(preset.devices).toHaveLength(1);
            expect(preset.devices[0]?.type).toBe('fermenter');
            expect(preset.devices[0]?.name).toBe(preset.name);
        }
    });

    it('should drop version, name, and macroMappings from the device parameterValues wire format', () => {
        for (const preset of FERMENTER_PRESETS) {
            const parameterValues = preset.devices[0]?.parameterValues ?? {};

            expect(parameterValues).not.toHaveProperty('version');
            expect(parameterValues).not.toHaveProperty('name');
            expect(parameterValues).not.toHaveProperty('macroMappings');
        }
    });

    it('should expand the eight-element macros tuple into macro0..macro7 parameter keys', () => {
        const initPreset = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-init');
        expect(initPreset).toBeDefined();

        const parameterValues = initPreset?.devices[0]?.parameterValues ?? {};
        for (const [index, macroValue] of DEFAULT_PATCH.macros.entries()) {
            expect(parameterValues[`macro${index}`]).toBe(macroValue);
        }
        expect(parameterValues.macros).toBeUndefined();
    });

    it('should carry every non-macro numeric DEFAULT_PATCH field into parameterValues unless overridden', () => {
        const acidBass = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-acid-bass');
        expect(acidBass).toBeDefined();

        const parameterValues = acidBass?.devices[0]?.parameterValues ?? {};

        // Overridden fields carry the preset's own values, not the defaults.
        expect(parameterValues.filterCutoff).toBe(600);
        expect(parameterValues.filterResonance).toBe(8);

        // Fields the preset does not override still fall back to DEFAULT_PATCH.
        expect(parameterValues.masterGain).toBe(DEFAULT_PATCH.masterGain);
        expect(parameterValues.oscLevel).toBe(DEFAULT_PATCH.oscLevel);
    });

    it('ships the MS-20 presets with the stability-verified voicing', () => {
        const crustyScream = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-ms20-lead');
        const crackerClav = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-clavinet');

        expect(crustyScream?.devices[0]?.parameterValues).toMatchObject({
            oscEngine: 1,
            oscWaveform: 1,
            filterModel: 4,
            filterCutoff: 1500,
            filterResonance: 7,
            filterDrive: 3,
            ampSustain: 0.7,
            filterEnvAmount: 0.8,
            portamentoTime: 0.05,
            distMix: 0.15,
            distDrive: 2,
        });
        expect(crackerClav?.devices[0]?.parameterValues).toMatchObject({
            oscEngine: 1,
            oscWaveform: 2,
            filterModel: 4,
            filterCutoff: 3000,
            filterResonance: 4,
            ampAttack: 0.002,
            ampDecay: 0.3,
            ampSustain: 0.1,
            ampRelease: 0.1,
            filterDecay: 0.15,
            filterEnvAmount: 0.8,
        });
    });

    it('keeps the shipped Karplus sitar on the audible glide path', () => {
        const sitar = FERMENTER_PRESETS.find((preset) => preset.id === 'fermenter-sitar-deep');

        expect(sitar?.devices[0]?.parameterValues).toMatchObject({
            oscEngine: 3,
            portamentoTime: 0.06,
        });
    });

    it('should only use known sound preset categories', () => {
        const categories = new Set([
            'synth',
            'bass',
            'pad',
            'lead',
            'keys',
            'drums',
            'fx',
            'vocal',
            'guitar',
            'strings',
        ]);

        for (const preset of FERMENTER_PRESETS) {
            expect(categories.has(preset.category)).toBe(true);
        }
    });

    it('should tag every preset with the fermenter tag and attribute it to Sourdaw as a factory preset', () => {
        for (const preset of FERMENTER_PRESETS) {
            expect(preset.tags).toContain('fermenter');
            expect(preset.author).toBe('Sourdaw');
            expect(preset.isFactory).toBe(true);
            expect(preset.trackKind).toBe('midi');
        }
    });
});
