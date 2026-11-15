import { type OfflineDeviceNode } from '../types';

// ── Reverb impulse rendering ─────────────────────────────────────────────
//
// The builtin reverb's tail IS its impulse response, so `rev-size`,
// `rev-decay` and `rev-damping` shape the rendered buffer itself:
//   - `rev-decay` (descriptor unit `s`) is the decay time: the exponential
//     envelope reaches -60 dB exactly at the end of the buffer.
//   - `rev-size` (0..1) scales the early-reflection window — the region of
//     discrete, spaced taps before the diffuse tail begins. Bigger rooms
//     spread their early reflections over a longer window.
//   - `rev-damping` (0..1) is tone: a one-pole lowpass over the impulse,
//     mapped logarithmically from an almost open top end to a dark tail.

export type ReverbImpulseShape = {
    size: number;
    decay: number;
    damping: number;
};

/** Descriptor defaults for `rev-size`, `rev-decay`, `rev-damping`. */
export const DEFAULT_REVERB_SHAPE: ReverbImpulseShape = { size: 0.5, decay: 2, damping: 0.5 };

/** Declared descriptor ranges; enforced here so any write source is safe. */
export const REVERB_SIZE_RANGE = { min: 0, max: 1 } as const;
export const REVERB_DECAY_RANGE = { min: 0.1, max: 20 } as const;
export const REVERB_DAMPING_RANGE = { min: 0, max: 1 } as const;

/** Amplitude ratio of a -60 dB tail: the impulse ends exactly this quiet. */
const T60_AMPLITUDE_RATIO = 0.001;

/** Longest early-reflection window, in seconds, at `rev-size` = 1. */
const EARLY_WINDOW_MAX_SEC = 0.08;
/** Silence between discrete early taps, relative to a full-amplitude tap. */
const EARLY_REGION_FILL = 0.15;
/** Spacing of the discrete early taps, in seconds. */
const EARLY_TAP_SPACING_SEC = 0.006;

/** High-frequency tone the impulse keeps at `rev-damping` = 0. */
const DAMPING_OPEN_HZ = 18_000;
/** High-frequency tone the impulse keeps at `rev-damping` = 1. */
const DAMPING_CLOSED_HZ = 1_200;

const IMPULSE_CHANNELS = 2;

type PartialShape = Partial<ReverbImpulseShape>;

const clamp = (value: number, range: { min: number; max: number }): number =>
    Math.min(range.max, Math.max(range.min, value));

/**
 * How many distinct impulse shapes one audio context may keep rendered buffers
 * for. Shape writes arrive at pointer-move rate while a musician sweeps a knob,
 * so an unbounded map would retain hundreds of megabytes of dead AudioBuffers
 * for the context's lifetime; a small FIFO serves the working set (a project
 * uses a handful of shapes) and evicts the oldest rendered buffer instead.
 */
const IMPULSE_CACHE_CAPACITY = 8;

const reverbImpulseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Owning context of each factory-built convolver, so later writes can render. */
const reverbContexts = new WeakMap<ConvolverNode, BaseAudioContext>();

/** Latest written (unbucketed) shape after a successful installation, so partial writes merge with written values. */
const reverbShapes = new WeakMap<ConvolverNode, ReverbImpulseShape>();

/**
 * Ratio between neighbouring Decay buckets: half the 5 % just-noticeable
 * difference of reverberation time (ISO 3382-1, Annex A), so an installed
 * impulse never trails the written decay by an audible amount.
 */
const DECAY_BUCKET_RATIO = 1.025;
/** Size and Damping buckets: one hundredth of their 0..1 range. */
const UNIT_BUCKETS = 100;

type ShapeBuckets = { size: number; decay: number; damping: number };

function shapeBuckets(shape: ReverbImpulseShape): ShapeBuckets {
    const unitBucket = (value: number): number => Math.round(value * UNIT_BUCKETS);
    return {
        size: unitBucket(shape.size),
        decay: Math.round(Math.log(shape.decay) / Math.log(DECAY_BUCKET_RATIO)),
        damping: unitBucket(shape.damping),
    };
}

/**
 * The one shape every value in a bucket renders: derived from the bucket
 * alone, never from whichever value entered it first, so the impulse for a
 * written value is the same after a ramp, after a reload, and in an offline
 * export that never saw the ramp.
 */
function bucketShape(buckets: ShapeBuckets): ReverbImpulseShape {
    return {
        size: clamp(buckets.size / UNIT_BUCKETS, REVERB_SIZE_RANGE),
        decay: clamp(DECAY_BUCKET_RATIO ** buckets.decay, REVERB_DECAY_RANGE),
        damping: clamp(buckets.damping / UNIT_BUCKETS, REVERB_DAMPING_RANGE),
    };
}

/**
 * The shape's equivalence bucket. Rendering and installing an impulse costs
 * time proportional to its decay, and live automation writes these
 * parameters on every scheduler tick, so a bucket finer than an audible step
 * makes a ramp re-render on every tick and starves the main thread (#6743).
 */
function impulseCacheKey(buckets: ShapeBuckets): string {
    return `${buckets.size}|${buckets.decay}|${buckets.damping}`;
}

function resolveConvolver(dn: OfflineDeviceNode): ConvolverNode | null {
    const named = dn.namedNodes?.convolver;
    if (named) {
        return named as ConvolverNode;
    }
    const positional = dn.nodes[3];
    return positional ? (positional as ConvolverNode) : null;
}

function renderReverbImpulse(ctx: BaseAudioContext, shape: ReverbImpulseShape): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const decaySec = clamp(shape.decay, REVERB_DECAY_RANGE);
    const length = Math.max(1, Math.round(sampleRate * decaySec));
    const impulse = ctx.createBuffer(IMPULSE_CHANNELS, length, sampleRate);

    const earlyEnd = Math.round(sampleRate * EARLY_WINDOW_MAX_SEC * clamp(shape.size, REVERB_SIZE_RANGE));
    const tapSpacing = Math.max(1, Math.round(sampleRate * EARLY_TAP_SPACING_SEC));
    // Logarithmic tone map: damping 0 keeps the open top end, 1 collapses to the dark floor.
    const damping = clamp(shape.damping, REVERB_DAMPING_RANGE);
    const cutoffHz = DAMPING_OPEN_HZ * (DAMPING_CLOSED_HZ / DAMPING_OPEN_HZ) ** damping;
    const lowpassCoefficient = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);

    // -60 dB lands exactly at the end of the buffer: the declared decay time.
    const decaySlope = Math.log(T60_AMPLITUDE_RATIO) / Math.max(1, length - earlyEnd - 1);

    for (let channel = 0; channel < IMPULSE_CHANNELS; channel++) {
        const data = impulse.getChannelData(channel);
        let lowpassState = 0;
        let state = (0x9e3779b9 ^ sampleRate ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
        for (let index = 0; index < length; index++) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            let sample = ((state >>> 0) / 0xffff_ffff) * 2 - 1;
            const inEarlyWindow = index < earlyEnd;
            if (inEarlyWindow && index % tapSpacing !== 0) {
                sample *= EARLY_REGION_FILL;
            }
            const tailIndex = Math.max(0, index - earlyEnd);
            const envelope = inEarlyWindow ? 1 : Math.exp(decaySlope * tailIndex);
            lowpassState += lowpassCoefficient * (sample - lowpassState);
            data[index] = lowpassState * envelope;
        }
    }
    return impulse;
}

/**
 * Rebuild the convolver impulse of a reverb device from a partial
 * size/decay/damping write. Absent keys merge with the shape already
 * installed (descriptor defaults before the first write), a cache-key change
 * installs the new buffer, and an unchanged cache key is a no-op. The context is only
 * required the first time a factory introduces its convolver; later writes
 * reuse the remembered one.
 */
export function applyReverbImpulseShape(
    dn: OfflineDeviceNode,
    ctx: BaseAudioContext | undefined,
    shape: PartialShape
): void {
    const convolver = resolveConvolver(dn);
    if (!convolver) {
        return;
    }
    // A convolver this factory never built has no remembered context; unless
    // the write actually asks for a new shape there is nothing to do.
    const shapesUnwritten = shape.size === undefined && shape.decay === undefined && shape.damping === undefined;
    if (shapesUnwritten && !reverbContexts.has(convolver)) {
        return;
    }
    const context = ctx ?? reverbContexts.get(convolver);
    if (!context) {
        throw new Error('reverb convolver has no owning context; pass it from the factory');
    }
    const installed = reverbShapes.get(convolver);
    const current = installed ?? DEFAULT_REVERB_SHAPE;
    const merged: ReverbImpulseShape = {
        size: shape.size !== undefined ? clamp(shape.size, REVERB_SIZE_RANGE) : current.size,
        decay: shape.decay !== undefined ? clamp(shape.decay, REVERB_DECAY_RANGE) : current.decay,
        damping: shape.damping !== undefined ? clamp(shape.damping, REVERB_DAMPING_RANGE) : current.damping,
    };
    const buckets = shapeBuckets(merged);
    const key = impulseCacheKey(buckets);
    if (installed && key === impulseCacheKey(shapeBuckets(installed))) {
        reverbShapes.set(convolver, merged);
        return;
    }
    reverbContexts.set(convolver, context);
    const cache = reverbImpulseCache.get(context) ?? new Map<string, AudioBuffer>();
    reverbImpulseCache.set(context, cache);
    let buffer = cache.get(key);
    if (!buffer) {
        buffer = renderReverbImpulse(context, bucketShape(buckets));
        while (cache.size >= IMPULSE_CACHE_CAPACITY) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            cache.delete(oldest);
        }
        cache.set(key, buffer);
    }
    convolver.buffer = buffer;
    reverbShapes.set(convolver, merged);
}
