import { detectTransients as detectSourceTransients } from '../../models/TransientDetection';

export type TransientHit = ReturnType<typeof detectSourceTransients>[number];

/** Keep the public read signature while the pure detector also runs inside an isolated Worker. */
export function detectTransients(
    samples: Float32Array,
    sampleRate: number,
    sensitivity: number
): readonly TransientHit[] {
    return detectSourceTransients(samples, sampleRate, sensitivity);
}
