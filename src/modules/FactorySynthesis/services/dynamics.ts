import type { MonoBuffer, StereoBuffer } from './types';

export function softClip(buf: MonoBuffer, drive = 1): void {
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.tanh(buf[i]! * drive);
    }
}

export function softClipStereo(buf: StereoBuffer, drive = 1): void {
    softClip(buf[0], drive);
    softClip(buf[1], drive);
}

export function normalize(buf: MonoBuffer, targetPeak = 0.95): void {
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]!);
        if (a > peak) {
            peak = a;
        }
    }
    if (peak === 0) {
        return;
    }
    const scale = targetPeak / peak;
    for (let i = 0; i < buf.length; i++) {
        buf[i]! *= scale;
    }
}

export function normalizeStereo(buf: StereoBuffer, targetPeak = 0.95): void {
    let peak = 0;
    for (let c = 0; c < 2; c++) {
        const ch = buf[c]!;
        for (let i = 0; i < ch.length; i++) {
            const a = Math.abs(ch[i]!);
            if (a > peak) {
                peak = a;
            }
        }
    }
    if (peak === 0) {
        return;
    }
    const scale = targetPeak / peak;
    for (let c = 0; c < 2; c++) {
        const ch = buf[c]!;
        for (let i = 0; i < ch.length; i++) {
            ch[i]! *= scale;
        }
    }
}
