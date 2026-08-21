/// <reference lib="webworker" />
/**
 * Grand Boule engine Worker. Runs the WASM piano engine on a dedicated thread
 * and renders ahead into the SharedArrayBuffer ring consumed by the worklet.
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
 *     producerContextFrame = consumerContextFrame + (writeHead - readHead)
 *
 * The consumer publishes its absolute context frame beside the matching modular
 * ring read head into `syncSab` once per render quantum. The worker unwraps its
 * write head relative to that snapshot, and `init` carries a `contextFrame` anchor
 * for the window before the consumer has run a single block — a few milliseconds
 * at node construction, long before the transport can schedule into it. A note
 * whose frame is not yet reached is queued and drained against the block the
 * engine is about to produce; a note already past it voices immediately, exactly
 * as an unscheduled one does.
 *
 * Port protocol (self.onmessage):
 *   ← { type: 'init', initId: number, wasmModule: WebAssembly.Module, sab: SharedArrayBuffer,
 *       sampleRate: number, syncSab?: SharedArrayBuffer, contextFrame?: number }
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

import {
    GRAND_BOULE_CONTROL_HEADER_BYTES,
    GRAND_BOULE_CONTROL_INT_COUNT,
    GRAND_BOULE_FLUSH_GENERATION_IDX,
    GRAND_BOULE_FLUSH_HEAD_IDX,
    GRAND_BOULE_LIFECYCLE_CONTINUE,
    GRAND_BOULE_LIFECYCLE_IDX,
    GRAND_BOULE_LIFECYCLE_SLEEP,
    GRAND_BOULE_READ_HEAD_IDX,
    GRAND_BOULE_RENDER_REQUEST_IDX,
    GRAND_BOULE_SLEEP_HEAD_IDX,
    GRAND_BOULE_WRITE_HEAD_IDX,
} from '../models/GrandBouleRingProtocol';
import { type GrandBouleInstance } from '../wasm/daw_dsp.js';
import { type GrandBouleConsumerClock, readGrandBouleConsumerClock } from '../worklets/grandBouleConsumerClock';
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
const MAX_BLOCKS_PER_RENDER = Math.ceil(TARGET_AHEAD / BLOCK_SIZE) + 1;

/** Zero-delay yield via MessageChannel. Posts a message to ourselves that
 *  fires as a macrotask — after any pending onmessage handlers (MIDI events)
 *  but without the artificial 1–4 ms floor that setTimeout imposes. */
const yieldChannel = new MessageChannel();
let renderScheduled = false;
const scheduleRender = (): void => {
    if (!running || renderScheduled) {
        return;
    }
    renderScheduled = true;
    yieldChannel.port2.postMessage(renderGeneration);
};
yieldChannel.port1.onmessage = (event: MessageEvent<number>) => {
    if (event.data !== renderGeneration) {
        return;
    }
    renderScheduled = false;
    renderLoop(event.data);
};

let instance: GrandBouleInstance | null = null;
let memory: WebAssembly.Memory | null = null;
let running = false;
let activeInitId: number | null = null;
let renderGeneration = 0;
let waitingForDemand = false;
let demandWaitGeneration = 0;

// SAB layout: [writeHead: Int32, readHead: Int32, leftRing: Float32[], rightRing: Float32[]]
let controlInts: Int32Array | null = null;
let leftRing: Float32Array | null = null;
let rightRing: Float32Array | null = null;
let ringFrames = 0;

/**
 * Consumer sync: a seqlocked SAB carrying the AudioWorklet's absolute context
 * frame and the modular read head observed at that frame. The split low/high
 * context value preserves the AudioContext epoch when the ring's Int32 cursors
 * wrap. Kept out of the ring SAB so the ring layout — and every acquire/release
 * proof written against it — is untouched.
 */
let syncInts: Int32Array | null = null;

/**
 * Context frame the engine's frame 0 is expected to be heard at, taken from the
 * host context's clock at node-construction time.
 *
 * An estimate, and only ever a short-lived one: the consumer's first published
 * clock snapshot replaces it within a few milliseconds of the node existing, long before
 * the transport can schedule anything into it. It used to be exact for the one
 * case that no longer arrives here — an offline render, whose clock sits at 0
 * through its whole scheduling phase.
 */
let anchorContextFrame = 0;
const consumerClock: GrandBouleConsumerClock = { contextFrame: 0, readHead: 0 };
let hasConsumerClock = false;

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

    // Copy directly instead of allocating short-lived subarray views on every
    // rendered block.
    for (let index = 0; index < firstChunk; index++) {
        leftRing[offset + index] = leftSrc[index] ?? 0;
        rightRing[offset + index] = rightSrc[index] ?? 0;
    }
    for (let index = 0; index < secondChunk; index++) {
        leftRing[index] = leftSrc[firstChunk + index] ?? 0;
        rightRing[index] = rightSrc[firstChunk + index] ?? 0;
    }

    const nextWriteHead = (writeHead + blockSize) | 0;
    // Release fence: publish the frames atomically after they are all written.
    Atomics.store(controlInts, GRAND_BOULE_WRITE_HEAD_IDX, nextWriteHead);
    return nextWriteHead;
}

type InitEngineInput = {
    initId: number;
    wasmModule: WebAssembly.Module;
    sab: SharedArrayBuffer;
    workerSampleRate: number;
    syncSab?: SharedArrayBuffer;
    contextFrame?: number;
};

function initEngine({ initId, wasmModule, sab, workerSampleRate, syncSab, contextFrame }: InitEngineInput): void {
    if (!Number.isSafeInteger(initId)) {
        throw new TypeError('Grand Boule worker initId must be a safe integer');
    }
    if (!Number.isFinite(workerSampleRate) || workerSampleRate <= 0) {
        throw new Error('Grand Boule worker sampleRate must be positive and finite');
    }

    const nextSyncInts = syncSab ? new Int32Array(syncSab) : null;
    const nextAnchorContextFrame = contextFrame !== undefined && Number.isFinite(contextFrame) ? contextFrame : 0;

    const floatBytes = sab.byteLength - GRAND_BOULE_CONTROL_HEADER_BYTES;
    const bytesPerStereoFrame = 2 * Float32Array.BYTES_PER_ELEMENT;
    if (floatBytes % bytesPerStereoFrame !== 0 || floatBytes / bytesPerStereoFrame < BLOCK_SIZE) {
        throw new Error('Grand Boule worker received an invalid ring buffer');
    }
    const nextRingFrames = floatBytes / bytesPerStereoFrame;
    const nextControlInts = new Int32Array(sab, 0, GRAND_BOULE_CONTROL_INT_COUNT);
    const nextLeftRing = new Float32Array(sab, GRAND_BOULE_CONTROL_HEADER_BYTES, nextRingFrames);
    const nextRightRing = new Float32Array(
        sab,
        GRAND_BOULE_CONTROL_HEADER_BYTES + nextRingFrames * Float32Array.BYTES_PER_ELEMENT,
        nextRingFrames
    );

    // Build the engine before publishing any new global state or resetting the
    // shared ring. If construction fails, the worker can report the real error
    // without leaving a half-initialized renderer behind.
    const engine = createGrandBouleInstance({ wasmModule, sampleRate: workerSampleRate });

    // Consumer sync plane. Reset the worker-local cache so an offset read by a
    // previous engine instance can never be reused as this one's.
    //
    // The consumer is initialised at node construction and so may already have
    // published into this slot by the time we get here. That value is not stale:
    // it is this ring's own consumer reporting a `readHead` still at 0, which is
    // a sharper estimate than `contextFrame` — taken earlier — and it is
    // republished on the consumer's next quantum regardless.
    syncInts = nextSyncInts;
    anchorContextFrame = nextAnchorContextFrame;
    hasConsumerClock = false;
    noteQueue.clear();

    // Parse SAB layout.
    controlInts = nextControlInts;
    ringFrames = nextRingFrames;
    leftRing = nextLeftRing;
    rightRing = nextRightRing;

    // Reset heads.
    Atomics.store(controlInts, GRAND_BOULE_WRITE_HEAD_IDX, 0);
    Atomics.store(controlInts, GRAND_BOULE_READ_HEAD_IDX, 0);
    Atomics.store(controlInts, GRAND_BOULE_RENDER_REQUEST_IDX, 0);
    Atomics.store(controlInts, GRAND_BOULE_FLUSH_GENERATION_IDX, 0);
    Atomics.store(controlInts, GRAND_BOULE_FLUSH_HEAD_IDX, 0);

    memory = engine.memory;
    instance = engine.instance;
    activeInitId = initId;
    running = true;
    renderGeneration++;
    renderScheduled = false;
    waitingForDemand = false;
    demandWaitGeneration++;
    const lifecycleState = instance.lifecycle_state();
    Atomics.store(controlInts, GRAND_BOULE_SLEEP_HEAD_IDX, lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP ? 0 : -1);
    Atomics.store(controlInts, GRAND_BOULE_LIFECYCLE_IDX, lifecycleState);
    self.postMessage({ type: 'ready' });
    if (lifecycleState !== GRAND_BOULE_LIFECYCLE_SLEEP) {
        scheduleRender();
    }
}

function waitForRenderDemand(): void {
    if (!running || waitingForDemand || !controlInts) {
        return;
    }

    const expectedRequest = Atomics.load(controlInts, GRAND_BOULE_RENDER_REQUEST_IDX);
    const writeHead = Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX);
    const readHead = Atomics.load(controlInts, GRAND_BOULE_READ_HEAD_IDX);
    const buffered = (writeHead - readHead) | 0;
    if (buffered < TARGET_AHEAD && ringFrames - buffered >= BLOCK_SIZE) {
        scheduleRender();
        return;
    }

    const generation = demandWaitGeneration;
    const waitResult = Atomics.waitAsync(controlInts, GRAND_BOULE_RENDER_REQUEST_IDX, expectedRequest);
    if (!waitResult.async) {
        scheduleRender();
        return;
    }

    waitingForDemand = true;
    void waitResult.value.then(() => {
        if (generation !== demandWaitGeneration) {
            return false;
        }
        waitingForDemand = false;
        scheduleRender();
        return true;
    });
}

function stopEngine(): void {
    running = false;
    activeInitId = null;
    renderGeneration++;
    renderScheduled = false;
    waitingForDemand = false;
    demandWaitGeneration++;
    if (controlInts) {
        Atomics.add(controlInts, GRAND_BOULE_RENDER_REQUEST_IDX, 1);
        Atomics.notify(controlInts, GRAND_BOULE_RENDER_REQUEST_IDX);
    }
    instance = null;
    memory = null;
    controlInts = null;
    leftRing = null;
    rightRing = null;
    ringFrames = 0;
    syncInts = null;
    anchorContextFrame = 0;
    hasConsumerClock = false;
    noteQueue.clear();
}

/**
 * First context frame *after* the block starting at `writeHead`. Exclusive: a
 * note landing exactly on it belongs to the next block, not this one.
 *
 * Once the consumer has published, the modular difference between this write
 * head and the matching read head unwraps the producer position across signed
 * Int32 rollover. Before that first snapshot, the short-lived construction-time
 * anchor maps producer frame zero onto the host clock.
 */
function blockEndContextFrame(writeHead: number): number {
    if (syncInts && readGrandBouleConsumerClock(syncInts, consumerClock)) {
        hasConsumerClock = true;
    }
    if (!hasConsumerClock) {
        return writeHead + BLOCK_SIZE + anchorContextFrame;
    }

    const framesAhead = (writeHead - consumerClock.readHead) | 0;
    return consumerClock.contextFrame + framesAhead + BLOCK_SIZE;
}

function renderLoop(generation: number): void {
    if (
        generation !== renderGeneration ||
        !running ||
        !instance ||
        !controlInts ||
        !leftRing ||
        !rightRing ||
        !memory
    ) {
        return;
    }

    // Render as many blocks as needed to stay TARGET_AHEAD of the consumer,
    // using a bounded loop instead of recursion to avoid stack overflow.
    for (let index = 0; index < MAX_BLOCKS_PER_RENDER; index++) {
        const writeHead = Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX);
        const readHead = Atomics.load(controlInts, GRAND_BOULE_READ_HEAD_IDX);
        const buffered = (writeHead - readHead) | 0;

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
        const nextWriteHead = writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            writeHead,
            blockViews.left,
            blockViews.right,
            BLOCK_SIZE
        );

        const lifecycleState = instance.lifecycle_state();
        const hasScheduledNotes = noteQueue.size() > 0;
        if (lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP && !hasScheduledNotes) {
            Atomics.store(controlInts, GRAND_BOULE_SLEEP_HEAD_IDX, nextWriteHead);
            Atomics.store(controlInts, GRAND_BOULE_LIFECYCLE_IDX, lifecycleState);
            return;
        }
        Atomics.store(controlInts, GRAND_BOULE_SLEEP_HEAD_IDX, -1);
        const effectiveLifecycle =
            lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP ? GRAND_BOULE_LIFECYCLE_CONTINUE : lifecycleState;
        Atomics.store(controlInts, GRAND_BOULE_LIFECYCLE_IDX, effectiveLifecycle);

        // Atomics.pause is a Stage 3 proposal — cast to an extended type that includes it
        type AtomicsWithPause = typeof Atomics & { pause?: () => void };
        (Atomics as AtomicsWithPause).pause?.();
    }

    // Block without polling until the worklet consumes frames. `waitAsync`
    // leaves this Worker's event queue responsive to MIDI and controls.
    waitForRenderDemand();
}

type GrandBouleWorkerMsg =
    | {
          type: 'init';
          initId: number;
          wasmModule: WebAssembly.Module;
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
        blockEndFrame = blockEndContextFrame(Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX));
    }

    receiveGrandBouleMessage({ instance, queue: noteQueue, msg, blockEndFrame });

    if (!controlInts) {
        return;
    }
    if (msg.type === 'allNotesOff') {
        const writeHead = Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX);
        Atomics.store(controlInts, GRAND_BOULE_FLUSH_HEAD_IDX, writeHead);
        Atomics.add(controlInts, GRAND_BOULE_FLUSH_GENERATION_IDX, 1);
    }

    const lifecycleState = instance.lifecycle_state();
    const hasScheduledNotes = noteQueue.size() > 0;
    if (lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP && !hasScheduledNotes) {
        Atomics.store(controlInts, GRAND_BOULE_SLEEP_HEAD_IDX, Atomics.load(controlInts, GRAND_BOULE_WRITE_HEAD_IDX));
        Atomics.store(controlInts, GRAND_BOULE_LIFECYCLE_IDX, lifecycleState);
        return;
    }

    Atomics.store(controlInts, GRAND_BOULE_SLEEP_HEAD_IDX, -1);
    const effectiveLifecycle =
        lifecycleState === GRAND_BOULE_LIFECYCLE_SLEEP ? GRAND_BOULE_LIFECYCLE_CONTINUE : lifecycleState;
    Atomics.store(controlInts, GRAND_BOULE_LIFECYCLE_IDX, effectiveLifecycle);
    scheduleRender();
}

self.onmessage = ({ data }: MessageEvent<GrandBouleWorkerMsg>): void => {
    if (data.type === 'init') {
        if (activeInitId !== null) {
            if (data.initId === activeInitId) {
                // Delivery retries are idempotent: acknowledge the engine that
                // is already running without resetting its ring or scheduling a
                // second permanent render-loop chain.
                self.postMessage({ type: 'ready' });
            } else {
                self.postMessage({
                    type: 'error',
                    message: 'Grand Boule worker is already initialized; create a new Worker for another engine',
                });
            }
            return;
        }

        try {
            initEngine({
                initId: data.initId,
                wasmModule: data.wasmModule,
                sab: data.sab,
                workerSampleRate: data.sampleRate,
                syncSab: data.syncSab,
                contextFrame: data.contextFrame,
            });
        } catch (error) {
            stopEngine();
            const message = error instanceof Error ? error.message : 'Grand Boule worker initialization failed';
            self.postMessage({ type: 'error', message });
        }
    } else if (data.type === 'stop') {
        stopEngine();
    } else {
        receive(data);
    }
};
