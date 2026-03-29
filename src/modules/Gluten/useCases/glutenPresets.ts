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

function preset(id: string, name: string, category: string, overrides: Partial<GlutenPatch>): GlutenPreset {
    return { id, name, category, patch: { ...DEFAULT_PATCH, ...overrides, name } };
}

export const GLUTEN_PRESETS: readonly GlutenPreset[] = [
    // ── Glue / Bus ──
    preset('glue-bus', 'Bus Glue', 'bus', {
        topology: 'vca', threshold: -18, ratio: 4, attack: 10, autoRelease: true, knee: 6, range: 15,
    }),
    preset('glue-gentle', 'Gentle Glue', 'bus', {
        topology: 'vca', threshold: -12, ratio: 2, attack: 30, autoRelease: true, knee: 10, range: 10,
    }),
    preset('glue-tight', 'Tight Bus', 'bus', {
        topology: 'vca', threshold: -20, ratio: 4, attack: 3, release: 200, autoRelease: false, knee: 3,
    }),

    // ── Opto / Smooth ──
    preset('opto-vocal', 'Opto Vocal', 'vocal', {
        topology: 'opto', threshold: -25, limitMode: false,
    }),
    preset('opto-leveler', 'Opto Leveler', 'bus', {
        topology: 'opto', threshold: -20, limitMode: false,
    }),
    preset('opto-limit', 'Opto Limiter', 'mastering', {
        topology: 'opto', threshold: -15, limitMode: true,
    }),

    // ── FET / Punch ──
    preset('fet-snare', 'FET Snare Crush', 'drums', {
        topology: 'fet', threshold: -24, ratio: 8, attack: 0.2, release: 250, inputGain: 6,
    }),
    preset('fet-vocal', 'FET Vocal Bite', 'vocal', {
        topology: 'fet', threshold: -20, ratio: 4, attack: 0.8, release: 300,
    }),
    preset('fet-all-buttons', 'All Buttons In', 'creative', {
        topology: 'fet', threshold: -30, allButtons: true, attack: 0.1, release: 100, inputGain: 12,
    }),
    preset('fet-parallel', 'Parallel Smash', 'drums', {
        topology: 'fet', threshold: -30, ratio: 20, attack: 0.02, release: 200, mix: 0.3, inputGain: 12,
    }),

    // ── Diode Bridge ──
    preset('diode-master', 'Diode Master', 'mastering', {
        topology: 'diode', threshold: -16, ratio: 2, recovery: 3,
    }),
    preset('diode-warm', 'Warm Diode Glue', 'bus', {
        topology: 'diode', threshold: -18, ratio: 3, recovery: 4,
    }),

    // ── Mastering ──
    preset('master-transparent', 'Transparent Master', 'mastering', {
        topology: 'vca', threshold: -10, ratio: 2, attack: 30, autoRelease: true, knee: 12,
        range: 6, scHpfFreq: 120, scHpfEnabled: true,
    }),
    preset('master-loud', 'Loud Master', 'mastering', {
        topology: 'vca', threshold: -15, ratio: 4, attack: 10, autoRelease: true, knee: 6,
        range: 10, scHpfFreq: 100, scHpfEnabled: true, thrust: 2,
    }),

    // ── Creative ──
    preset('pump-edm', 'EDM Pump', 'creative', {
        topology: 'vca', threshold: -15, ratio: 4, attack: 0.5, release: 800, autoRelease: false,
        knee: 3, range: 20,
    }),
    preset('ny-compression', 'New York Compression', 'drums', {
        topology: 'fet', threshold: -28, ratio: 12, attack: 0.1, release: 150,
        mix: 0.35, inputGain: 10,
    }),
];
