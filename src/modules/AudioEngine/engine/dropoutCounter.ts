/**
 * Engine dropout counters (audit RT-10).
 *
 * Before this, an RT glitch left no trace anywhere: Grand Boule already
 * *detected* ring-buffer starvation and emitted silence, silently, and nothing
 * else in the engine counted anything. `getHealth()` reported init/resume
 * errors only — nothing runtime.
 *
 * ## What this counts
 *
 * Render quanta in which a device could not source the audio it needed and
 * emitted silence instead — a dropout the engine itself observed. Today the one
 * such detector is the Grand Boule SPSC ring (`grandBouleProcessor`): when the
 * engine Worker has not published a full quantum, the processor leaves the ring
 * untouched and outputs silence. Startup pre-roll, before the Worker's first
 * block, is deliberately excluded — that gap is expected, not a dropout.
 *
 * ## What this does NOT count
 *
 * Named explicitly so the number is not mistaken for a general glitch metric:
 *
 * - **Host/driver xruns.** The AudioContext render callback missing its
 *   deadline is invisible from inside `AudioWorkletGlobalScope`: `currentFrame`
 *   stays contiguous across one, so no worklet-side comparison detects it.
 * - **GC pauses and over-budget `process()` calls that still produced samples.**
 *   Audible, but the worklet scope exposes no wall clock to self-time against.
 * - **Starvation inside a native/third-party plugin's own host process.**
 * - **Silence from a faulted processor** falling back to passthrough — that is
 *   an error path, surfaced separately.
 *
 * So: "dropouts the engine detected", not "every dropout the user heard".
 * Non-zero is always a real problem; zero is not a clean bill of health.
 *
 * ## Transport
 *
 * A small `SharedArrayBuffer` of Int32 counters. The render thread bumps them
 * with `Atomics.add` / `Atomics.store` — no allocation, no lock, no port
 * traffic, bounded work — and the main thread reads them straight out of that
 * memory through `getHealth()`. No polling of the audio thread, no messages.
 *
 * The three fields are read as independent atomic loads, not under a seqlock.
 * They are monotone tallies rather than a coherent snapshot, so a read can
 * catch a block count one increment ahead of its frame count. That is fine for
 * a diagnostic tally and keeps the render thread's increment path to three
 * atomic ops.
 */

import { hasSharedArrayBuffer } from '#/utils/capabilities';

import type { AudioEngineDropoutStats } from '../models/AudioEngineState';

/**
 * Int32 slot layout of the dropout SAB. Mirrored by literal in
 * `worklets/grandBouleProcessor.ts` and in
 * `public/audio/worklets/native-plugin-bridge-processor.js` — worklet code
 * stays isolated from app modules, so every side pins the same indices.
 */
export const DROPOUT_IDX = Object.freeze({
    detectedUnderrunBlocks: 0,
    silentFrames: 1,
    lastUnderrunAtFrame: 2,
    bridgeDroppedBlocks: 3,
});

/** Every slot in the layout above. Grow both together. */
const DROPOUT_SLOTS = 4;

const EMPTY_DROPOUT_STATS: AudioEngineDropoutStats = {
    detectedUnderrunBlocks: 0,
    silentFrames: 0,
    lastUnderrunAtFrame: 0,
    bridgeDroppedBlocks: 0,
};

class DropoutCounters {
    private sab: SharedArrayBuffer | null = null;
    private view: Int32Array | null = null;

    /**
     * The buffer to hand a worklet on init, or `null` when `SharedArrayBuffer`
     * is unavailable (no cross-origin isolation). Every caller gets the same
     * buffer, so counts from several devices aggregate into one tally.
     */
    getSab(): SharedArrayBuffer | null {
        if (!hasSharedArrayBuffer()) {
            return null;
        }
        if (!this.sab) {
            this.sab = new SharedArrayBuffer(DROPOUT_SLOTS * Int32Array.BYTES_PER_ELEMENT);
            this.view = new Int32Array(this.sab);
        }
        return this.sab;
    }

    /** Current tally. All-zero before any worklet has been wired. */
    read(): AudioEngineDropoutStats {
        const view = this.view;
        if (!view) {
            return EMPTY_DROPOUT_STATS;
        }
        return {
            detectedUnderrunBlocks: Atomics.load(view, DROPOUT_IDX.detectedUnderrunBlocks),
            silentFrames: Atomics.load(view, DROPOUT_IDX.silentFrames),
            lastUnderrunAtFrame: Atomics.load(view, DROPOUT_IDX.lastUnderrunAtFrame),
            bridgeDroppedBlocks: Atomics.load(view, DROPOUT_IDX.bridgeDroppedBlocks),
        };
    }

    /**
     * Zero the tally in place, so a new session does not inherit the previous
     * one's counts. Zeroing in place (rather than reallocating) keeps every
     * already-initialized worklet writing into the live buffer.
     */
    reset(): void {
        const view = this.view;
        if (!view) {
            return;
        }
        for (let index = 0; index < DROPOUT_SLOTS; index++) {
            Atomics.store(view, index, 0);
        }
    }
}

export const dropoutCounters = new DropoutCounters();
