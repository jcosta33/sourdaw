/**
 * Service: linear sample-rate conversion for raw mono PCM.
 *
 * Grand Boule's sampled-attack pathway plays an attack-transient
 * clip back at the engine's sample rate. A clip authored at a different rate
 * (e.g. a 48 kHz capture loaded onto a 44.1 kHz engine) would otherwise be
 * replayed frame-for-frame and sound ~9 % sharp/flat. This converts the clip
 * to the engine rate first, so its pitch and duration are preserved.
 *
 * Linear interpolation is intentional: the attack transient is short, and a
 * cheap, allocation-bounded, dependency-free pass keeps the load path simple.
 * The function is pure — no AudioContext, no I/O — so the ratio/length math is
 * unit-testable in isolation.
 */

/**
 * Resample a mono `Float32Array` from `fromRate` to `toRate` via linear
 * interpolation.
 *
 * - Returns the input unchanged when the rates already match (or either rate is
 *   non-finite / non-positive — a defensive no-op rather than producing NaNs).
 * - Output length is `round(input.length * toRate / fromRate)`, so a 48 kHz →
 *   44.1 kHz conversion shortens the buffer by the rate ratio and a same-rate
 *   pass returns identical length.
 *
 * Index access is bounds-checked: `noUncheckedIndexedAccess` makes
 * `samples[i]` a `number | undefined`, so every read is guarded and clamped to
 * the last valid frame at the tail rather than reaching past the end.
 */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
        return samples;
    }
    if (fromRate === toRate) {
        return samples;
    }

    const sourceLength = samples.length;
    if (sourceLength === 0) {
        return samples;
    }
    if (sourceLength === 1) {
        // A single frame carries no pitch; nothing to interpolate.
        return samples;
    }

    const ratio = toRate / fromRate;
    const outputLength = Math.max(1, Math.round(sourceLength * ratio));
    const output = new Float32Array(outputLength);

    const lastIndex = sourceLength - 1;
    const step = 1 / ratio; // source frames advanced per output frame
    for (let outIndex = 0; outIndex < outputLength; outIndex++) {
        const sourcePos = outIndex * step;
        const baseIndex = Math.floor(sourcePos);
        const frac = sourcePos - baseIndex;

        // Bounds-safe reads: clamp both taps to [0, lastIndex] so the final
        // output frames never index past the source. `?? 0` satisfies
        // noUncheckedIndexedAccess; the clamp guarantees a defined value, so it
        // is a type guard, not a behavioural fallback.
        const loIndex = clampIndex(baseIndex, lastIndex);
        const hiIndex = clampIndex(loIndex + 1, lastIndex);
        const lo = samples[loIndex] ?? 0;
        const hi = samples[hiIndex] ?? 0;

        output[outIndex] = lo + (hi - lo) * frac;
    }

    return output;
}

/** Clamp `index` into the inclusive range `[0, lastIndex]`. */
function clampIndex(index: number, lastIndex: number): number {
    if (index < 0) {
        return 0;
    }
    if (index > lastIndex) {
        return lastIndex;
    }
    return index;
}
