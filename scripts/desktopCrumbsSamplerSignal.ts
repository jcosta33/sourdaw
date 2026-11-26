import type { CrumbsWindow } from './desktopCrumbsSamplerEvidence.ts';

export function measureCrumbsWindow(raw: {
    firstFrame: number;
    endFrame: number;
    sampleRate: number;
    values: number[];
}): CrumbsWindow {
    if (raw.endFrame !== raw.firstFrame + raw.values.length || raw.values.some((value) => !Number.isFinite(value))) {
        throw new Error('capture-window-invalid');
    }
    const magnitude = (samples: number[], hz: number): number => {
        let strongest = 0;
        for (const shift of [-1, 0, 1]) {
            let real = 0;
            let imaginary = 0;
            let weight = 0;
            for (let index = 0; index < samples.length; index++) {
                const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (samples.length - 1));
                const phase = (2 * Math.PI * hz * (1 + shift * 0.005) * index) / raw.sampleRate;
                real += samples[index]! * w * Math.cos(phase);
                imaginary += samples[index]! * w * Math.sin(phase);
                weight += w;
            }
            strongest = Math.max(strongest, (2 * Math.hypot(real, imaginary)) / weight);
        }
        return strongest;
    };
    const tail = raw.values.slice(-32768);
    let minimumSentinel220 = Infinity;
    for (let index = 0; index < raw.values.length; index += 8192) {
        minimumSentinel220 = Math.min(minimumSentinel220, magnitude(raw.values.slice(index, index + 8192), 220));
    }
    return {
        firstFrame: raw.firstFrame,
        frames: raw.values.length,
        sampleRate: raw.sampleRate,
        tone431: magnitude(tail, 431),
        tone619: magnitude(tail, 619),
        sentinel220: magnitude(tail, 220),
        minimumSentinel220,
    };
}
