/**
 * Gluten compressor presets — curated starting points for common use cases.
 */
import { type GlutenPatch, DEFAULT_PATCH } from '../models/GlutenPatch';

export type GlutenPreset = {
    id: string;
    name: string;
    category: string;
    patch: GlutenPatch;
};

function inferStyle(overrides: Partial<GlutenPatch>): GlutenPatch['style'] {
    if (overrides.style) {
        return overrides.style;
    }

    if (overrides.topology === 'fet') {
        return 'punch';
    }

    if (overrides.topology === 'opto') {
        return 'smooth';
    }

    if (overrides.topology === 'diode') {
        return 'glue';
    }

    return 'glue';
}

function preset(id: string, name: string, category: string, overrides: Partial<GlutenPatch>): GlutenPreset {
    return {
        id,
        name,
        category,
        patch: {
            ...DEFAULT_PATCH,
            ...overrides,
            name,
            style: inferStyle(overrides),
        },
    };
}

export const GLUTEN_PRESETS: readonly GlutenPreset[] = [
    // ── Glue / Bus ──
    preset('glue-bus', 'Bus Glue', 'bus', {
        topology: 'vca',
        threshold: -18,
        ratio: 4,
        attack: 10,
        autoRelease: true,
        knee: 6,
        range: 15,
    }),
    preset('glue-gentle', 'Gentle Glue', 'bus', {
        topology: 'vca',
        threshold: -12,
        ratio: 2,
        attack: 30,
        autoRelease: true,
        knee: 10,
        range: 10,
    }),
    preset('glue-tight', 'Tight Bus', 'bus', {
        topology: 'vca',
        threshold: -20,
        ratio: 4,
        attack: 3,
        release: 200,
        autoRelease: false,
        knee: 3,
    }),

    // ── Opto / Smooth ──
    // Every preset below this point states `autoRelease: false`, and none of
    // them would otherwise: `DEFAULT_PATCH.autoRelease` is `true`, so a preset
    // that says nothing inherits an Auto rel that only the VCA implements. That
    // left ten presets shipping the chip lit on a topology that cannot hear it
    // — the same defect as `Loud Master`'s `thrust: 2`, one flag over, and
    // found by the rule written to catch that one rather than by inspection.
    // The default is left alone because it is correct for the VCA, which is
    // what a fresh device runs.
    preset('opto-vocal', 'Opto Vocal', 'vocal', {
        topology: 'opto',
        threshold: -25,
        limitMode: false,
        autoRelease: false,
    }),
    preset('opto-leveler', 'Opto Leveler', 'bus', {
        topology: 'opto',
        threshold: -20,
        limitMode: false,
        autoRelease: false,
    }),
    preset('opto-limit', 'Opto Limiter', 'mastering', {
        topology: 'opto',
        threshold: -15,
        limitMode: true,
        autoRelease: false,
    }),

    // ── FET / Punch ──
    preset('fet-snare', 'FET Snare Crush', 'drums', {
        topology: 'fet',
        threshold: -24,
        ratio: 8,
        attack: 0.2,
        release: 250,
        inputGain: 6,
        autoRelease: false,
    }),
    preset('fet-vocal', 'FET Vocal Bite', 'vocal', {
        topology: 'fet',
        threshold: -20,
        ratio: 4,
        attack: 0.8,
        release: 300,
        autoRelease: false,
    }),
    preset('fet-all-buttons', 'All Buttons In', 'creative', {
        topology: 'fet',
        threshold: -30,
        allButtons: true,
        attack: 0.1,
        release: 100,
        inputGain: 12,
        autoRelease: false,
    }),
    preset('fet-parallel', 'Parallel Smash', 'drums', {
        topology: 'fet',
        threshold: -30,
        ratio: 20,
        attack: 0.02,
        release: 200,
        mix: 0.3,
        inputGain: 12,
        autoRelease: false,
    }),

    // ── Diode Bridge ──
    preset('diode-master', 'Diode Master', 'mastering', {
        topology: 'diode',
        threshold: -16,
        ratio: 2,
        recovery: 3,
        autoRelease: false,
    }),
    preset('diode-warm', 'Warm Diode Glue', 'bus', {
        topology: 'diode',
        threshold: -18,
        ratio: 3,
        recovery: 4,
        autoRelease: false,
    }),

    // ── Mastering ──
    preset('master-transparent', 'Transparent Master', 'mastering', {
        topology: 'vca',
        threshold: -10,
        ratio: 2,
        attack: 30,
        autoRelease: true,
        knee: 12,
        range: 6,
        // `scHpfFreq` without `scHpfEnabled`. Both Master presets are VCA, and
        // the detector filters only reach the diode — so shipping the filter
        // *engaged* advertised a sidechain HPF that never ran, and once the
        // panel started gating those controls it became a setting the user
        // could not switch off either. The frequency is kept because it is the
        // preset's intent and is correct the moment the topology can hear it;
        // the switch is not, because a preset must not enable a stage its own
        // topology cannot run.
        scHpfFreq: 120,
    }),
    preset('master-loud', 'Loud Master', 'mastering', {
        topology: 'vca',
        threshold: -15,
        ratio: 4,
        attack: 10,
        autoRelease: true,
        knee: 6,
        range: 10,
        // Same as Transparent Master above, plus `thrust` — this preset shipped
        // `thrust: 2` on a VCA, which is the worse case: with a diode Stage two
        // engaged the detector would have run at Thrust *loud*, a setting the
        // user never chose and, after gating, could not zero.
        scHpfFreq: 100,
    }),

    // ── Creative ──
    preset('pump-edm', 'EDM Pump', 'creative', {
        style: 'pump',
        topology: 'vca',
        threshold: -15,
        ratio: 4,
        attack: 0.5,
        release: 800,
        autoRelease: false,
        knee: 3,
        range: 20,
    }),
    preset('ny-compression', 'New York Compression', 'drums', {
        topology: 'fet',
        threshold: -28,
        ratio: 12,
        attack: 0.1,
        release: 150,
        mix: 0.35,
        inputGain: 10,
        autoRelease: false,
    }),
];
