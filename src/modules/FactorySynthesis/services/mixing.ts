import type { MonoBuffer, StereoBuffer } from './types';

export function mixMono(dst: MonoBuffer, src: MonoBuffer, gain: number, offsetSamples = 0): void {
    const end = Math.min(dst.length, offsetSamples + src.length);
    for (let i = Math.max(0, offsetSamples); i < end; i++) {
        dst[i]! += src[i - offsetSamples]! * gain;
    }
}

export function mixMonoIntoStereo(
    dst: StereoBuffer,
    src: MonoBuffer,
    gain: number,
    pan: number,
    offsetSamples = 0
): void {
    const leftGain = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const rightGain = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    const [dl, dr] = dst;
    const end = Math.min(dl.length, offsetSamples + src.length);
    for (let i = Math.max(0, offsetSamples); i < end; i++) {
        const v = src[i - offsetSamples]!;
        dl[i]! += v * leftGain;
        dr[i]! += v * rightGain;
    }
}
