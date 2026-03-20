/**
 * Modulator Library — Factory presets for the modulation system.
 * Pre-built modulation source configurations for common effects.
 */
import {
    createModulationSource,
    updateModulationSourceParam,
    type ModulationSource,
    type ModulationSourceType,
} from '#/modules/AudioEngine/useCases/modulationSystem';

export type ModulatorPreset = {
    id: string;
    name: string;
    category: string;
    description: string;
    sourceType: ModulationSourceType;
    parameters: Record<string, number>;
};

export const MODULATOR_PRESETS: ModulatorPreset[] = [
    // ─── LFO Presets ──────────────────────────
    {
        id: 'lfo-slow-wobble',
        name: 'Slow Wobble',
        category: 'LFO',
        description: 'Gentle slow sine wave for subtle motion',
        sourceType: 'lfo',
        parameters: { rate: 0.5, depth: 0.3, phase: 0, waveform: 0 },
    },
    {
        id: 'lfo-tremolo',
        name: 'Tremolo',
        category: 'LFO',
        description: 'Classic tremolo at moderate speed',
        sourceType: 'lfo',
        parameters: { rate: 4, depth: 0.6, phase: 0, waveform: 0 },
    },
    {
        id: 'lfo-fast-vibrato',
        name: 'Fast Vibrato',
        category: 'LFO',
        description: 'Fast sine for pitch vibrato',
        sourceType: 'lfo',
        parameters: { rate: 6, depth: 0.15, phase: 0, waveform: 0 },
    },
    {
        id: 'lfo-auto-pan',
        name: 'Auto Pan',
        category: 'LFO',
        description: 'Triangle wave for smooth L-R panning',
        sourceType: 'lfo',
        parameters: { rate: 1, depth: 1.0, phase: 0, waveform: 3 },
    },
    {
        id: 'lfo-square-gate',
        name: 'Square Gate',
        category: 'LFO',
        description: 'Rhythmic on/off gating effect',
        sourceType: 'lfo',
        parameters: { rate: 2, depth: 1.0, phase: 0, waveform: 2 },
    },
    {
        id: 'lfo-sidechain-pump',
        name: 'Sidechain Pump',
        category: 'LFO',
        description: 'Sawtooth wave simulating sidechain compression',
        sourceType: 'lfo',
        parameters: { rate: 2, depth: 0.8, phase: 0.25, waveform: 1 },
    },
    {
        id: 'lfo-subtle-movement',
        name: 'Subtle Movement',
        category: 'LFO',
        description: 'Very slow triangle for evolving textures',
        sourceType: 'lfo',
        parameters: { rate: 0.1, depth: 0.2, phase: 0, waveform: 3 },
    },

    // ─── Envelope Presets ─────────────────────
    {
        id: 'env-pluck',
        name: 'Pluck',
        category: 'Envelope',
        description: 'Fast attack, short decay, no sustain',
        sourceType: 'envelope',
        parameters: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
    },
    {
        id: 'env-pad',
        name: 'Pad Swell',
        category: 'Envelope',
        description: 'Slow attack, high sustain for pads',
        sourceType: 'envelope',
        parameters: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 1.5 },
    },
    {
        id: 'env-snappy',
        name: 'Snappy',
        category: 'Envelope',
        description: 'Medium attack with punchy decay',
        sourceType: 'envelope',
        parameters: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.3 },
    },

    // ─── Random Presets ───────────────────────
    {
        id: 'rand-slow-drift',
        name: 'Slow Drift',
        category: 'Random',
        description: 'Slow random movement with heavy smoothing',
        sourceType: 'random',
        parameters: { rate: 0.5, smoothing: 0.9 },
    },
    {
        id: 'rand-fast-chaos',
        name: 'Fast Chaos',
        category: 'Random',
        description: 'Rapid random changes for glitch effects',
        sourceType: 'random',
        parameters: { rate: 16, smoothing: 0.1 },
    },

    // ─── Macro Presets ────────────────────────
    {
        id: 'macro-performance',
        name: 'Performance Knob',
        category: 'Macro',
        description: 'Single knob controlling multiple parameters',
        sourceType: 'macro',
        parameters: { value: 0.5 },
    },
    {
        id: 'macro-morph',
        name: 'Morph Control',
        category: 'Macro',
        description: 'Crossfade/morph between two states',
        sourceType: 'macro',
        parameters: { value: 0 },
    },
];

/**
 * Instantiate a modulation source from a preset.
 */
export function createFromPreset(presetId: string): ModulationSource | null {
    const preset = MODULATOR_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
        return null;
    }

    const source = createModulationSource(preset.sourceType, preset.name);
    for (const [param, value] of Object.entries(preset.parameters)) {
        updateModulationSourceParam(source.id, param, value);
    }
    return source;
}

/**
 * Get presets grouped by category.
 */
export function getPresetsByCategory(): Map<string, ModulatorPreset[]> {
    const grouped = new Map<string, ModulatorPreset[]>();
    for (const preset of MODULATOR_PRESETS) {
        const list = grouped.get(preset.category) ?? [];
        list.push(preset);
        grouped.set(preset.category, list);
    }
    return grouped;
}
