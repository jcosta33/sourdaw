/**
 * Load an attack-transient clip into the Grand Boule hybrid sampled-attack
 * pathway.
 *
 * `samples` is a raw mono PCM Float32Array captured at `sourceSampleRate`. The
 * engine plays the clip back frame-for-frame at its own context sample rate, so
 * a clip authored at a different rate (e.g. a 48 kHz capture on a 44.1 kHz
 * engine) is resampled to the engine rate here first — otherwise it would sound
 * ~9 % off-pitch. A same-rate clip passes through unchanged. The engine
 * truncates clips longer than its internal maximum.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { resampleLinear } from '../services/resampleLinear';

type LoadGrandBouleAttackClipInput = {
    engine: GrandBouleEngineHandle;
    key: number;
    samples: Float32Array;
    /** Sample rate (Hz) the `samples` buffer was captured at. */
    sourceSampleRate: number;
};

export function loadGrandBouleAttackClip(input: LoadGrandBouleAttackClipInput): void {
    if (input.key < 1 || input.key > 88) {
        return;
    }
    const engineRate = input.engine.sampleRate();
    const samples = resampleLinear(input.samples, input.sourceSampleRate, engineRate);
    input.engine.loadAttackClip({ key: input.key, samples });
}
