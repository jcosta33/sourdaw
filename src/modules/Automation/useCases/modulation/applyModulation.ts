import { modulationStore } from '../../stores/modulationStore';

/**
 * Apply procedural modulation for the current playhead position.
 * Computes runtime values for all active modulators (LFO, Env, Step).
 * R-F2: Output feeds into modulation halos.
 */
export function applyModulation(playheadBeat: number): void {
    const state = modulationStore.value;
    if (!state || state.modulators.length === 0) {
        return;
    }

    const runtimeValues: Record<string, number> = { ...state.runtimeValues };
    let changed = false;

    for (const mod of state.modulators) {
        if (!mod.enabled) {continue;}

        let value = 0;
        const cfg = mod.config;

        if (cfg.kind === 'lfo') {
            const period = cfg.rate || 1;
            const phase = cfg.phase || 0;
            const x = (playheadBeat / period + phase) % 1;

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
                    // Pseudo-random based on beat for consistency
                    value = Math.abs((Math.sin(Math.floor(playheadBeat / period) * 12.9898) * 43758.5453123) % 1);
                    break;
            }
            value *= cfg.depth;
        } else if (cfg.kind === 'step') {
            const period = cfg.rate || 1;
            const stepIdx = Math.floor(playheadBeat / period) % cfg.steps.length;
            value = cfg.steps[stepIdx] ?? 0;
        }

        if (runtimeValues[mod.id] !== value) {
            runtimeValues[mod.id] = value;
            changed = true;
        }
    }

    if (changed) {
        modulationStore.set({ ...state, runtimeValues });
    }
}
