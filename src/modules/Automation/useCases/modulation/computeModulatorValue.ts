import { type Modulator } from '../../models/Modulator';

export function computeModulatorValue(modulator: Modulator, playheadBeat: number): number {
    const cfg = modulator.config;

    if (cfg.kind === 'lfo') {
        const period = cfg.rate || 1;
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
                value = Math.abs((Math.sin(Math.floor(playheadBeat / period) * 12.9898) * 43758.5453123) % 1);
                break;
        }
        return value * cfg.depth;
    }

    if (cfg.kind === 'step') {
        const period = cfg.rate || 1;
        const len = cfg.steps.length;
        if (len === 0) {
            return 0;
        }
        const stepIdx = ((Math.floor(playheadBeat / period) % len) + len) % len;
        return cfg.steps[stepIdx] ?? 0;
    }

    return 0;
}
