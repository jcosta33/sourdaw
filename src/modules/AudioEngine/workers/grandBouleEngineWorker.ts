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
 * Note timing
 * -----------
 * `noteOn`, `noteOff` and `noteExpression` carry an optional `sampleFrame` — an
 * absolute frame on the *AudioContext* clock, the same domain the transport
 * scheduler and the offline renderer already speak. The engine's own clock is
 * the ring write head, which counts frames the engine has produced, so the two
 * are related by a constant the worker cannot see on its own:
 *
 *     contextFrame = engineFrame + consumerOffset
 *
 * The consumer publishes `consumerOffset` (`currentFrame - readHead`) into
 * `syncSab` once per render quantum, and `init` carries a `contextFrame` anchor
 * for the window before the consumer has run a single block — which is the whole
 * of an offline render's scheduling phase, where every note is posted before
 * `startRendering()`. A note whose frame is not yet reached is queued and drained
 * against the block the engine is about to produce; a note already past it voices
 * immediately, exactly as an unscheduled one does.
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

import { initSync, GrandBouleInstance } from '../wasm/daw_dsp.js';

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

/** Map camelCase param names from TypeScript to snake_case for Rust. */
const PARAM_MAP: Record<string, string> = {
    masterGain: 'master_gain',
    soundboardSend: 'soundboard_send',
    sympatheticSend: 'sympathetic_send',
    stretchAmount: 'stretch_amount',
    attackBite: 'attack_bite',
    velocityCurve: 'velocity_curve',
    hammerHardnessScale: 'hammer_hardness_scale',
    hammerMassScale: 'hammer_mass_scale',
    soundboardBrightness: 'soundboard_brightness',
    sympatheticLevel: 'sympathetic_level',
    bodyResonance: 'body_resonance',
    toneColor: 'tone_color',
};

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
 * host context's clock at node-construction time. Exact for an offline render
 * (its clock is still at 0); live it is an estimate that the consumer's first
 * published offset replaces within a few milliseconds of the node existing —
 * long before the transport can schedule anything into it.
 */
let anchorContextFrame = 0;

/**
 * Notes waiting for the block that contains their frame, ordered by frame, with
 * `noteQueueHead` as the read index so draining never shifts the array.
 *
 * Bounded by the transport's scheduling look-ahead (100 ms) rather than by the
 * part length: the scheduler only ever hands over the next window. This worker
 * is not the audio thread — it owns a full OS timeslice and its deadline is the
 * ring's headroom, not a 2.67 ms quantum — but the render path still allocates
 * nothing: only `enqueueFramed`, which runs on message arrival, touches the
 * array's capacity.
 */
const noteQueue: GrandBouleQueuedMsg[] = [];
let noteQueueHead = 0;

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
    // Consumer sync plane. Reset before the consumer can publish, so a stale
    // offset from a previous instance can never be read as this one's.
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
    noteQueue.length = 0;
    noteQueueHead = 0;

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

    // Init WASM.
    const exports = initSync({ module: new WebAssembly.Module(wasmBytes) });
    memory = exports.memory;
    instance = new GrandBouleInstance(workerSampleRate, 64);
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

/**
 * Insert keeping the queue sorted by frame, and stable within a frame so a
 * `noteExpression` posted after its `noteOn` at the same frame still lands
 * behind it — the voice must exist before it is bent.
 */
function enqueueFramed(msg: GrandBouleQueuedMsg): void {
    let lo = noteQueueHead;
    let hi = noteQueue.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const candidate = noteQueue[mid];
        if (candidate && candidate.sampleFrame <= msg.sampleFrame) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    noteQueue.splice(lo, 0, msg);
}

/**
 * Voice everything due before `blockEnd`, which is exclusive — see
 * `blockEndContextFrame`.
 *
 * Note for anyone porting this back to the worklet processors: Levain, Fermenter
 * and Toaster break on `sampleFrame > blockEnd`, which drains a frame sitting
 * exactly on the boundary one block early. That off-by-one is deliberately not
 * reproduced here, and it is not fixed here either — it lives in three other
 * files and belongs in one change that moves all of them together.
 *
 * Steady state costs nothing beyond the comparison: no allocation, no atomics,
 * and the backing array is truncated only once the queue has fully drained.
 */
function drainNoteQueue(blockEnd: number): void {
    while (noteQueueHead < noteQueue.length) {
        const queued = noteQueue[noteQueueHead];
        if (!queued || queued.sampleFrame >= blockEnd) {
            break;
        }
        dispatch(queued);
        noteQueueHead++;
    }
    if (noteQueueHead >= noteQueue.length) {
        noteQueue.length = 0;
        noteQueueHead = 0;
    }
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
        drainNoteQueue(blockEndContextFrame(writeHead));

        // Render one block.
        const leftPtr = instance.process(BLOCK_SIZE);
        const rightPtr = instance.get_right_ptr();
        const mem = memory.buffer;
        const leftSrc = new Float32Array(mem, leftPtr, BLOCK_SIZE);
        const rightSrc = new Float32Array(mem, rightPtr, BLOCK_SIZE);

        // Write into the ring (wrapping) and release-publish the new write head.
        writeBlockRelease(controlInts, leftRing, rightRing, ringFrames, writeHead, leftSrc, rightSrc, BLOCK_SIZE);

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

type GrandBouleNoteOnMsg = {
    type: 'noteOn';
    midiNote: number;
    velocity: number;
    sampleFrame?: number;
    channel?: number;
};

type GrandBouleNoteOffMsg = {
    type: 'noteOff';
    midiNote: number;
    sampleFrame?: number;
    releaseVelocity?: number;
    channel?: number;
};

type GrandBouleNoteExpressionMsg = {
    type: 'noteExpression';
    midiNote: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};

/** The three messages that address a moment in time rather than the device. */
type GrandBouleFramedMsg = GrandBouleNoteOnMsg | GrandBouleNoteOffMsg | GrandBouleNoteExpressionMsg;

/** A framed message that actually carries a usable frame, so it can be queued. */
type GrandBouleQueuedMsg = GrandBouleFramedMsg & { sampleFrame: number };

type GrandBouleDispatchMsg =
    | GrandBouleNoteOnMsg
    | GrandBouleNoteOffMsg
    | GrandBouleNoteExpressionMsg
    | { type: 'param'; name: string; value: number }
    | { type: 'sustain'; position: number }
    | { type: 'unaCorda'; engaged: boolean }
    | { type: 'sostenuto'; engaged: boolean }
    | { type: 'noteOnMidi2'; midiNote: number; velocity16bit: number; pitchOffsetQ24: number }
    | { type: 'temperament'; index: number }
    | { type: 'loadAttackClip'; key: number; samples: Float32Array }
    | { type: 'allNotesOff' };

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

function dispatch(msg: GrandBouleDispatchMsg): void {
    if (!instance) {
        return;
    }
    switch (msg.type) {
        case 'noteOn':
            instance.note_on_with_channel(msg.midiNote, msg.velocity, msg.channel ?? 0);
            break;
        case 'noteExpression':
            // Grand Boule sounds bend only; pressure and slide are dropped
            // inside the engine rather than faked (audit MD-2).
            instance.note_expression(msg.midiNote, msg.channel, msg.bendSemitones, msg.pressure, msg.slide);
            break;
        case 'noteOff':
            // `msg.releaseVelocity` (normalized 0..1) is threaded to this engine
            // boundary from the live-MIDI Note Off. The current WASM ABI
            // (`note_off(midi_note)`) does not yet consume it; it is forwarded as
            // part of the typed message so the release dynamic is no longer
            // dropped at the control boundary.
            // Without a channel every voice at the pitch is released — the
            // historical behaviour channel-unaware callers rely on.
            if (msg.channel === undefined) {
                instance.note_off(msg.midiNote);
            } else {
                instance.note_off_on_channel(msg.midiNote, msg.channel);
            }
            break;
        case 'param':
            instance.set_param(PARAM_MAP[msg.name] ?? msg.name, msg.value);
            break;
        case 'sustain':
            instance.set_sustain(msg.position);
            break;
        case 'unaCorda':
            instance.set_una_corda(msg.engaged);
            break;
        case 'sostenuto':
            instance.set_sostenuto(msg.engaged);
            break;
        case 'noteOnMidi2':
            instance.note_on_midi2(msg.midiNote, msg.velocity16bit, msg.pitchOffsetQ24);
            break;
        case 'temperament':
            instance.set_temperament(msg.index);
            break;
        case 'loadAttackClip':
            instance.load_attack_clip(msg.key, msg.samples);
            break;
        case 'allNotesOff':
            // A panic must also drop what has not sounded yet, or the pending
            // look-ahead window keeps arriving after the user asked for silence.
            noteQueue.length = 0;
            noteQueueHead = 0;
            instance.all_notes_off();
            break;
    }
}

/** True when a framed message carries a frame this worker can actually place. */
function isPlaceable(msg: GrandBouleFramedMsg): msg is GrandBouleQueuedMsg {
    return msg.sampleFrame !== undefined && Number.isFinite(msg.sampleFrame);
}

function isFramed(msg: GrandBouleDispatchMsg): msg is GrandBouleFramedMsg {
    return msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression';
}

/**
 * Place a message at its frame, or voice it now.
 *
 * "Now" covers three cases that are all the pre-existing behaviour: no frame was
 * given, the ring is not up yet, or the frame is inside (or behind) the block
 * the engine is about to produce. A late note sounds late — never dropped, and
 * never held back a further block.
 */
function receive(msg: GrandBouleDispatchMsg): void {
    if (!isFramed(msg) || !isPlaceable(msg) || !controlInts) {
        dispatch(msg);
        return;
    }

    const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
    if (msg.sampleFrame < blockEndContextFrame(writeHead)) {
        dispatch(msg);
        return;
    }

    enqueueFramed(msg);
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
        noteQueue.length = 0;
        noteQueueHead = 0;
    } else {
        receive(data);
    }
};
