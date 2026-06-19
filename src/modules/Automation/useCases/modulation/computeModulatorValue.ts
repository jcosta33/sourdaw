import { type Modulator } from '../../models/Modulator';

/**
 * Seedable, reproducible pseudo-random value in [0, 1) for a given integer cell.
 *
 * The previous implementation used a GPU-shader-style hash
 * (`Math.sin(cell * 12.9898) * 43758.5453123`) which is not a defined PRNG: its
 * output depends on the host's `Math.sin` rounding, so two collaborators editing
 * the same project diverge on a CRDT merge. This is a Mulberry32 step seeded by
 * the cell index — deterministic across hosts and within the integer cell so the
 * sample-and-hold value holds for the whole period.
 */
function seededRandom(cell: number): number {
    // Mulberry32: pure integer arithmetic, no transcendental functions.
    let t = (cell >>> 0) + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function computeModulatorValue(modulator: Modulator, playheadBeat: number): number {
    const cfg = modulator.config;

    if (cfg.kind === 'lfo') {
        // `rate` is the period in beats. A non-positive rate has no defined cycle,
        // so the LFO sits at DC (no movement) rather than snapping to a 1-beat
        // period (the old `rate || 1` coercion silently animated a "stopped" LFO).
        if (cfg.rate <= 0) {
            return 0;
        }
        const period = cfg.rate;
        const phase = cfg.phase || 0;
        const x = (((playheadBeat / period + phase) % 1) + 1) % 1;
        let value = 0;

        switch (cfg.waveform) {
            case 'sine':
                value = (Math.sin(x * Math.PI * 2) + 1) / 2;
                break;
            case 'saw':
                value = x;
                break;
            case 'square':
                value = x < 0.5 ? 1 : 0;
                break;
            case 'triangle':
                value = x < 0.5 ? x * 2 : 2 - x * 2;
                break;
            case 'random':
                value = seededRandom(Math.floor(playheadBeat / period));
                break;
        }
        return value * cfg.depth;
    }

    if (cfg.kind === 'step') {
        // Period in beats; a non-positive rate has no defined cell, so hold the
        // first step (DC) rather than coercing to a 1-beat period.
        const len = cfg.steps.length;
        if (len === 0) {
            return 0;
        }
        if (cfg.rate <= 0) {
            return cfg.steps[0] ?? 0;
        }
        const period = cfg.rate;
        const stepIdx = ((Math.floor(playheadBeat / period) % len) + len) % len;
        return cfg.steps[stepIdx] ?? 0;
    }

    // 'envelope' modulators have no time-based evaluation: an ADSR needs a
    // trigger/gate time this signature does not carry, so they contribute no
    // modulation. The New-Modulator form hides the envelope option until a real
    // trigger model exists (see ModulationMatrix).
    return 0;
}
