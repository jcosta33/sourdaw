import { SAMPLE_RATE } from './constants';

import type { EnvelopeSpec, MonoBuffer } from './types';

export function renderEnvelope(durationSec: number, env: EnvelopeSpec, sampleRate: number = SAMPLE_RATE): MonoBuffer {
    const len = Math.max(1, Math.ceil(durationSec * sampleRate));
    const out = new Float32Array(len);
    const a = Math.max(0, env.attack ?? 0);
    const d = Math.max(0, env.decay ?? 0);
    const sLevel = env.sustainLevel ?? 0;
    const s = Math.max(0, env.sustain ?? 0);
    const r = Math.max(0, env.release ?? durationSec - a - d - s);
    const aSamp = Math.floor(a * sampleRate);
    const dSamp = Math.floor(d * sampleRate);
    const sSamp = Math.floor(s * sampleRate);
    const rSamp = Math.max(1, Math.floor(r * sampleRate));
    const curve = env.curve ?? 'exp';

    for (let i = 0; i < len; i++) {
        let v: number;
        if (i < aSamp) {
            const t = aSamp === 0 ? 1 : i / aSamp;
            v = t;
        } else if (i < aSamp + dSamp) {
            const t = dSamp === 0 ? 1 : (i - aSamp) / dSamp;
            v = curve === 'exp' ? (1 - t) ** 2 * (1 - sLevel) + sLevel : 1 - t * (1 - sLevel);
        } else if (i < aSamp + dSamp + sSamp) {
            v = sLevel;
        } else {
            const t = (i - aSamp - dSamp - sSamp) / rSamp;
            if (t >= 1) {
                v = 0;
            } else {
                v = curve === 'exp' ? sLevel * (1 - t) ** 2 : sLevel * (1 - t);
            }
        }
        out[i] = v;
    }
    return out;
}

export function applyEnvelope(buf: MonoBuffer, env: MonoBuffer): void {
    const len = Math.min(buf.length, env.length);
    for (let i = 0; i < len; i++) {
        buf[i]! *= env[i]!;
    }
    for (let i = len; i < buf.length; i++) {
        buf[i] = 0;
    }
}
