/// <reference lib="webworker" />
/**
 * Grand Boule Engine Worker — runs the WASM physical-modeling piano engine
 * on a dedicated thread, rendering ahead into a SharedArrayBuffer ring buffer
 * that the AudioWorklet consumes.
 *
 * This decouples the heavy DSP from the AudioWorklet's strict real-time
 * deadline (~2.67 ms per 128-sample quantum at 48 kHz). The Worker gets a
 * full OS timeslice and can absorb occasional spikes without causing glitches.
 *
 * **Live playback only.** Offline rendering used to come through here too and
 * that is what starved exports into 97-99 % silence: an `OfflineAudioContext`
 * has no deadline for the ring to protect (Web Audio §2.6), so its back-pressure
 * and macrotask pacing were pure cost. Renders now run the engine inside
 * `worklets/grandBouleOfflineProcessor`, over the shared
 * `worklets/grandBouleEngineCore` this file also uses. Nothing below is reached
 * by an export; do not reason about one from it.
 *
 * Note timing
 * -----------
 * `noteOn`, `noteOff` and `noteExpression` carry an optional `sampleFrame` — an
 * absolute frame on the *AudioContext* clock, the same domain the transport
 * scheduler speaks. The engine's own clock is the ring write head, which counts
 * frames the engine has produced, so the two are related by a constant the
 * worker cannot see on its own:
 *
 *     contextFrame = engineFrame + consumerOffset
 *
 * The consumer publishes `consumerOffset` (`currentFrame - readHead`) into
 * `syncSab` once per render quantum, and `init` carries a `contextFrame` anchor
 * for the window before the consumer has run a single block — a few milliseconds
 * at node construction, long before the transport can schedule into it. A note
 * whose frame is not yet reached is queued and drained against the block the
 * engine is about to produce; a note already past it voices immediately, exactly
 * as an unscheduled one does.
 *
 * Port protocol (self.onmessage):
 *   ← { type: 'init', wasmBytes: ArrayBuffer, sab: SharedArrayBuffer, sampleRate: number,
 *       syncSab?: SharedArrayBuffer, contextFrame?: number }
 *   → { type: 'ready' }
 *   ← { type: 'noteOn', midiNote, velocity, sampleFrame?, channel? }
 *   ← { type: 'noteExpression', midiNote, channel, bendSemitones, pressure, slide, sampleFrame? }
 *   ← { type: 'noteOff', midiNote, sampleFrame?, releaseVelocity }
 *   ← { type: 'param', name, value }
 *   ← { type: 'sustain', position }
 *   ← { type: 'unaCorda', engaged }
 *   ← { type: 'sostenuto', engaged }
 *   ← { type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 }
 *   ← { type: 'temperament', index }
 *   ← { type: 'loadAttackClip', key, samples }
 *   ← { type: 'allNotesOff' }
 *   ← { type: 'stop' }
 */

import { type GrandBouleInstance } from '../wasm/daw_dsp.js';
import {
    createGrandBouleBlockViews,
    createGrandBouleInstance,
    createGrandBouleNoteQueue,
    receiveGrandBouleMessage,
    type GrandBouleDispatchMsg,
} from '../worklets/grandBouleEngineCore';

/** Render block size — matches AudioWorklet quantum. */
const BLOCK_SIZE = 128;

/** Minimum frames of headroom to maintain in the ring buffer. The worker
 *  tries to stay this far ahead of the worklet's read position. */
const TARGET_AHEAD = BLOCK_SIZE * 6; // ~16 ms at 48 kHz

/** Zero-delay yield via MessageChannel. Posts a message to ourselves that
 *  fires as a macrotask — after any pending onmessage handlers (MIDI events)
 *  but without the artificial 1–4 ms floor that setTimeout imposes. */
const yieldChannel = new MessageChannel();
const scheduleRender = (): void => yieldChannel.port2.postMessage(null);
yieldChannel.port1.onmessage = () => renderLoop();

let instance: GrandBouleInstance | null = null;
let memory: WebAssembly.Memory | null = null;
let running = false;

// SAB layout: [writeHead: Int32, readHead: Int32, leftRing: Float32[], rightRing: Float32[]]
let controlInts: Int32Array | null = null;
let leftRing: Float32Array | null = null;
let rightRing: Float32Array | null = null;
let ringFrames = 0;

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;

/**
 * Consumer sync: a one-slot SAB the AudioWorklet publishes `currentFrame -
 * readHead` into every render quantum. Kept out of the ring SAB so the ring
 * layout — and every acquire/release proof written against it — is untouched.
 *
 * `CONSUMER_OFFSET_UNSET` is distinguishable from a real offset because a real
 * one is never negative: `readHead` only advances on a quantum in which
 * `currentFrame` also advanced, so the consumer can never be behind itself.
 */
const CONSUMER_OFFSET_IDX = 0;
const CONSUMER_OFFSET_UNSET = -1;
let syncInts: Int32Array | null = null;

/**
 * Context frame the engine's frame 0 is expected to be heard at, taken from the
 * host context's clock at node-construction time.
 *
 * An estimate, and only ever a short-lived one: the consumer's first published
 * offset replaces it within a few milliseconds of the node existing, long before
 * the transport can schedule anything into it. It used to be exact for the one
 * case that no longer arrives here — an offline render, whose clock sits at 0
 * through its whole scheduling phase.
 */
let anchorContextFrame = 0;

/**
 * Notes waiting for the block that contains their frame.
 *
 * Bounded by the transport's scheduling look-ahead (100 ms) rather than by the
 * part length: the scheduler only ever hands over the next window. This worker
 * is not the audio thread — it owns a full OS timeslice and its deadline is the
 * ring's headroom, not a 2.67 ms quantum — but the render path still allocates
 * nothing; see `createGrandBouleNoteQueue`.
 */
const noteQueue = createGrandBouleNoteQueue();

/**
 * Cached views over the engine's rendered block, shared with the offline host.
 * This loop used to mint a fresh pair of `Float32Array`s per block; it is not the
 * audio thread, so that was survivable rather than correct, and the cache also
 * carries the `memory.grow()` revalidation the raw views never had (audit RT-7).
 */
const blockViews = createGrandBouleBlockViews();

/**
 * Release-publish one rendered block into the SPSC ring.
 *
 * Copies `BLOCK_SIZE` stereo frames into the rings (wrapping), then advances the
 * write head with `Atomics.store(WRITE_HEAD_IDX, ...)`. That store is the release
 * fence: it is sequenced after the `.set()` copies, so a consumer that acquires
 * the head with `Atomics.load` before reading the ring can never observe the
 * head increment without the matching frames. Returns the new write head.
 *
 * Hot-path safe: no allocation, no blocking.
 */
export function writeBlockRelease(
    controlInts: Int32Array,
    leftRing: Float32Array,
    rightRing: Float32Array,
    ringFrames: number,
    writeHead: number,
    leftSrc: Float32Array,
    rightSrc: Float32Array,
    blockSize: number
): number {
    const offset = (writeHead >>> 0) % ringFrames;
    const firstChunk = Math.min(blockSize, ringFrames - offset);
    const secondChunk = blockSize - firstChunk;

    // Data writes — must be sequenced-before the release store below.
    leftRing.set(leftSrc.subarray(0, firstChunk), offset);
    rightRing.set(rightSrc.subarray(0, firstChunk), offset);
    if (secondChunk > 0) {
        leftRing.set(leftSrc.subarray(firstChunk), 0);
        rightRing.set(rightSrc.subarray(firstChunk), 0);
    }

    const nextWriteHead = (writeHead + blockSize) | 0;
    // Release fence: publish the frames atomically after they are all written.
    Atomics.store(controlInts, WRITE_HEAD_IDX, nextWriteHead);
    return nextWriteHead;
}

type InitEngineInput = {
    wasmBytes: ArrayBuffer;
    sab: SharedArrayBuffer;
    workerSampleRate: number;
    syncSab?: SharedArrayBuffer;
    contextFrame?: number;
};

function initEngine({ wasmBytes, sab, workerSampleRate, syncSab, contextFrame }: InitEngineInput): void {
    // Consumer sync plane. Reset so an offset left by a previous engine instance
    // sharing this slot can never be read as this one's.
    //
    // The consumer is initialised at node construction and so may already have
    // published into this slot by the time we get here. That value is not stale:
    // it is this ring's own consumer reporting a `readHead` still at 0, which is
    // a sharper estimate than `contextFrame` — taken earlier — and it is
    // republished on the consumer's next quantum regardless.
    if (syncSab) {
        syncInts = new Int32Array(syncSab);
        Atomics.store(syncInts, CONSUMER_OFFSET_IDX, CONSUMER_OFFSET_UNSET);
    } else {
        syncInts = null;
    }
    if (contextFrame !== undefined && Number.isFinite(contextFrame)) {
        anchorContextFrame = contextFrame;
    } else {
        anchorContextFrame = 0;
    }
    noteQueue.clear();

    // Parse SAB layout.
    controlInts = new Int32Array(sab, 0, 2);
    const headerBytes = 2 * Int32Array.BYTES_PER_ELEMENT; // 8 bytes
    const floatBytes = sab.byteLength - headerBytes;
    ringFrames = floatBytes / (2 * Float32Array.BYTES_PER_ELEMENT);
    leftRing = new Float32Array(sab, headerBytes, ringFrames);
    rightRing = new Float32Array(sab, headerBytes + ringFrames * Float32Array.BYTES_PER_ELEMENT, ringFrames);

    // Reset heads.
    Atomics.store(controlInts, WRITE_HEAD_IDX, 0);
    Atomics.store(controlInts, READ_HEAD_IDX, 0);

    // Init WASM. Constructed through the shared core so the live engine and the
    // offline one are the same instance at the same voice count.
    const engine = createGrandBouleInstance({ wasmBytes, sampleRate: workerSampleRate });
    memory = engine.memory;
    instance = engine.instance;
    running = true;
    self.postMessage({ type: 'ready' });
    scheduleRender();
}

/**
 * Frames the engine has produced, translated into the consumer's clock.
 *
 * The published offset wins whenever the consumer has run a block; before that
 * the `init` anchor stands in. Both express the same thing — the context frame
 * engine frame 0 lands on.
 */
function consumerOffset(): number {
    if (syncInts) {
        const published = Atomics.load(syncInts, CONSUMER_OFFSET_IDX);
        if (published !== CONSUMER_OFFSET_UNSET) {
            return published;
        }
    }
    return anchorContextFrame;
}

/**
 * First context frame *after* the block starting at `writeHead`. Exclusive: a
 * note landing exactly on it belongs to the next block, not this one.
 */
function blockEndContextFrame(writeHead: number): number {
    return writeHead + BLOCK_SIZE + consumerOffset();
}

function renderLoop(): void {
    if (!running || !instance || !controlInts || !leftRing || !rightRing || !memory) {
        return;
    }

    // Render as many blocks as needed to stay TARGET_AHEAD of the consumer,
    // using a bounded loop instead of recursion to avoid stack overflow.
    const maxBlocksPerTick = Math.ceil(TARGET_AHEAD / BLOCK_SIZE) + 1;
    let buffered = 0;

    for (let index = 0; index < maxBlocksPerTick; index++) {
        const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
        const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
        buffered = (writeHead - readHead) | 0;

        if (buffered >= TARGET_AHEAD || ringFrames - buffered < BLOCK_SIZE) {
            break; // Enough headroom or ring is full.
        }

        // Voice everything that belongs in the block about to be produced. This
        // has to run inside the loop, before each `process()`: the engine has no
        // sub-block note offset, so the block boundary is the only place a note
        // can be placed at all.
        noteQueue.drain(instance, blockEndContextFrame(writeHead));

        // Render one block.
        const leftPtr = instance.process(BLOCK_SIZE);
        const rightPtr = instance.get_right_ptr();
        // Read the buffer fresh after `process()`: a Rust-side allocation can
        // grow linear memory mid-call and detach the previous one.
        blockViews.update(memory.buffer, leftPtr, rightPtr, BLOCK_SIZE);

        // Write into the ring (wrapping) and release-publish the new write head.
        writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            writeHead,
            blockViews.left,
            blockViews.right,
            BLOCK_SIZE
        );

        // Atomics.pause is a Stage 3 proposal — cast to an extended type that includes it
        type AtomicsWithPause = typeof Atomics & { pause?: () => void };
        (Atomics as AtomicsWithPause).pause?.();
    }

    // Yield to the event loop so pending MIDI messages can be dispatched.
    // If the buffer is full, sleep for 2ms instead of spinning immediately.
    if (buffered >= TARGET_AHEAD) {
        setTimeout(scheduleRender, 2);
    } else {
        scheduleRender();
    }
}

type GrandBouleWorkerMsg =
    | {
          type: 'init';
          wasmBytes: ArrayBuffer;
          sab: SharedArrayBuffer;
          sampleRate: number;
          syncSab?: SharedArrayBuffer;
          contextFrame?: number;
      }
    | { type: 'stop' }
    | GrandBouleDispatchMsg;

/**
 * Hand one control message to the shared core, telling it where this host's
 * clock stands.
 *
 * The ring's write head plus the consumer offset is this transport's answer to
 * "which context frame does the block I am about to produce end at"; the offline
 * worklet answers the same question with `currentFrame + 128`. Everything after
 * that — enqueue or voice, and the engine call itself — is one implementation
 * shared by both, so the two hosts cannot disagree about a message.
 *
 * `null` before the ring is mapped: nothing can be placed yet, so voice now.
 */
function receive(msg: GrandBouleDispatchMsg): void {
    if (!instance) {
        return;
    }

    let blockEndFrame: number | null = null;
    if (controlInts) {
        blockEndFrame = blockEndContextFrame(Atomics.load(controlInts, WRITE_HEAD_IDX));
    }

    receiveGrandBouleMessage({ instance, queue: noteQueue, msg, blockEndFrame });
}

self.onmessage = ({ data }: MessageEvent<GrandBouleWorkerMsg>): void => {
    if (data.type === 'init') {
        initEngine({
            wasmBytes: data.wasmBytes,
            sab: data.sab,
            workerSampleRate: data.sampleRate,
            syncSab: data.syncSab,
            contextFrame: data.contextFrame,
        });
    } else if (data.type === 'stop') {
        running = false;
        noteQueue.clear();
    } else {
        receive(data);
    }
};
