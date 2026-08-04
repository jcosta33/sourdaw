import { describe, it, expect } from 'vitest';

import { createDefaultKit } from '../../models/ToasterKit';
import { TOASTER_PRESETS } from '../toasterPresets';

// Preset ids are the wire-format key used to look up a kit (getToasterPresetKit)
// and to render the preset picker (getToasterPresetSummaries). Pinning the full
// list here means a rename shows up as a diff instead of silently breaking any
// saved reference to an old id.
const EXPECTED_PRESET_IDS = [
    'init',
    '808-classic',
    '909-punchy',
    'trap-heavy',
    'lofi-crust',
    'minimal-techno',
    'dnb-roller',
    'house-classic',
    'industrial',
    'ambient-perc',
    'reggaeton',
    'acoustic-bread',
    'world-perc',
    'edm-festival',
    'psytrance-mycelium',
    'jazz-brush',
    'sp1200-crunch',
    'cinematic-perc',
    'garage-2step',
    'afrobeat',
    'fm-metallic',
    'glitch-bread',
    'latin-bread',
];

describe('TOASTER_PRESETS', () => {
    it('exposes exactly the expected preset ids, in order', () => {
        expect(TOASTER_PRESETS.map((preset) => preset.id)).toEqual(EXPECTED_PRESET_IDS);
    });

    it('never repeats a preset id', () => {
        const ids = TOASTER_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('tags every preset with the shared "toaster" tag first', () => {
        for (const preset of TOASTER_PRESETS) {
            expect(preset.tags[0]).toBe('toaster');
            expect(preset.tags.length).toBeGreaterThan(1);
        }
    });

    it('names every kit after its preset', () => {
        for (const preset of TOASTER_PRESETS) {
            expect(preset.kit.name).toBe(preset.name);
        }
    });

    it('gives every kit exactly 16 pads addressed by their array index', () => {
        for (const preset of TOASTER_PRESETS) {
            expect(preset.kit.pads).toHaveLength(16);
            expect(preset.kit.pads.map((pad) => pad.id)).toEqual(Array.from({ length: 16 }, (_, index) => index));
        }
    });

    it('leaves non-overridden kit fields at their createDefaultKit() baseline', () => {
        const baseline = createDefaultKit();
        for (const preset of TOASTER_PRESETS) {
            expect(preset.kit.version).toBe(baseline.version);
            expect(preset.kit.activePatternId).toBe(baseline.activePatternId);
            expect(preset.kit.patterns).toEqual(baseline.patterns);
        }
    });

    it('builds the init preset as an unmodified default kit renamed to "Blank Flour"', () => {
        const initPreset = TOASTER_PRESETS.find((preset) => preset.id === 'init');
        expect(initPreset).toBeDefined();

        expect(initPreset?.kit).toEqual({ ...createDefaultKit(), name: 'Blank Flour' });
    });

    it('does not attach generic-kick controls to circuit-model kick presets', () => {
        const classic = TOASTER_PRESETS.find((preset) => preset.id === '808-classic');
        const punchy = TOASTER_PRESETS.find((preset) => preset.id === '909-punchy');

        expect(classic?.kit.pads[0]?.engineParams).toEqual({});
        expect(punchy?.kit.pads[0]?.engineParams).toEqual({});
    });

    it('stores the audible FM voicing controls on metallic pads', () => {
        const metallic = TOASTER_PRESETS.find((preset) => preset.id === 'fm-metallic');

        expect(metallic?.kit.pads[1]?.engineParams).toEqual({ mod_ratio: 2.3, mod_amount: 3, feedback: 0.2 });
    });

    it('overrides only the kit-level fields a preset specifies, keeping the rest at baseline', () => {
        const baseline = createDefaultKit();
        const lofi = TOASTER_PRESETS.find((preset) => preset.id === 'lofi-crust');

        expect(lofi?.kit.reverbMix).toBe(0.25);
        expect(lofi?.kit.swing).toBe(0.3);
        // Fields lofi-crust never touches stay at the default.
        expect(lofi?.kit.delayMix).toBe(baseline.delayMix);
        expect(lofi?.kit.lofiBits).toBe(baseline.lofiBits);
    });

    it('authors a tight, role-balanced psychedelic trance kit without default pad wash', () => {
        const mycelium = TOASTER_PRESETS.find((preset) => preset.id === 'psytrance-mycelium');
        const kick = mycelium?.kit.pads[0];
        const hats = mycelium?.kit.pads.slice(2, 4) ?? [];
        const upperPercussion = mycelium?.kit.pads.slice(2) ?? [];

        expect(mycelium?.kit).toMatchObject({
            name: 'Mycelial Pulse',
            masterGain: 0.9,
            reverbMix: 0.08,
            delayMix: 0.02,
        });
        expect(kick).toMatchObject({
            engineType: 'kick-909',
            volume: 1,
            pan: 0,
            decay: 0.24,
            sendReverb: 0,
            sendDelay: 0,
        });
        expect(hats.map((pad) => pad.engineType)).toEqual(['hihat-closed', 'hihat-open']);
        expect(hats.every((pad) => pad.volume <= 0.5 && pad.filterCutoff <= 13_000)).toBe(true);
        expect(new Set(mycelium?.kit.pads.map((pad) => pad.volume)).size).toBeGreaterThan(8);
        expect(upperPercussion.some((pad) => pad.pan < 0)).toBe(true);
        expect(upperPercussion.some((pad) => pad.pan > 0)).toBe(true);
        expect(mycelium?.kit.pads.every((pad) => Object.keys(pad.engineParams).length === 0)).toBe(true);
    });
});
