/**
 * Load an attack-transient clip into the Grand Boule hybrid sampled-attack
 * pathway (§3.3).
 *
 * `samples` is a raw PCM Float32Array (mono, sample-rate-matched). The
 * engine truncates clips longer than its internal maximum.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

type LoadGrandBouleAttackClipInput = {
    engine: GrandBouleEngineHandle;
    key: number;
    samples: Float32Array;
};

export function loadGrandBouleAttackClip(input: LoadGrandBouleAttackClipInput): void {
    if (input.key < 1 || input.key > 88) {
        return;
    }
    input.engine.loadAttackClip({ key: input.key, samples: input.samples });
}
