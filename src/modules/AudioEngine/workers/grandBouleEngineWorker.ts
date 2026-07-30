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
 * Port protocol (self.onmessage):
 *   ← { type: 'init', wasmBytes: ArrayBuffer, sab: SharedArrayBuffer, sampleRate: number }
 *   → { type: 'ready' }
 *   ← { type: 'noteOn', midiNote, velocity, channel? }
 *   ← { type: 'noteExpression', midiNote, channel, bendSemitones, pressure, slide }
 *   ← { type: 'noteOff', midiNote, releaseVelocity }
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
const MAX_BLOCKS_PER_RENDER = Math.ceil(TARGET_AHEAD / BLOCK_SIZE) + 1;

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;
const RENDER_REQUEST_IDX = 2;
const SLEEP_HEAD_IDX = 3;
const LIFECYCLE_IDX = 4;
const FLUSH_GENERATION_IDX = 5;
const FLUSH_HEAD_IDX = 6;
const LIFECYCLE_SLEEP = 3;

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
    yieldChannel.port2.postMessage(null);
};
yieldChannel.port1.onmessage = () => {
    renderScheduled = false;
    renderLoop();
};

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
let waitingForDemand = false;
let demandWaitGeneration = 0;
let wasmBuffer: ArrayBuffer | SharedArrayBuffer | null = null;
let leftOutputView: Float32Array | null = null;
let rightOutputView: Float32Array | null = null;
let leftOutputPointer = -1;
let rightOutputPointer = -1;

// SAB layout: [writeHead: Int32, readHead: Int32, leftRing: Float32[], rightRing: Float32[]]
let controlInts: Int32Array | null = null;
let leftRing: Float32Array | null = null;
let rightRing: Float32Array | null = null;
let ringFrames = 0;

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

    // Copy directly instead of constructing short-lived subarray views on every
    // render block.
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
    Atomics.store(controlInts, WRITE_HEAD_IDX, nextWriteHead);
    return nextWriteHead;
}

function initEngine(wasmBytes: ArrayBuffer, sab: SharedArrayBuffer, workerSampleRate: number): void {
    // Parse SAB layout.
    controlInts = new Int32Array(sab, 0, 7);
    const headerBytes = 7 * Int32Array.BYTES_PER_ELEMENT;
    const floatBytes = sab.byteLength - headerBytes;
    ringFrames = floatBytes / (2 * Float32Array.BYTES_PER_ELEMENT);
    leftRing = new Float32Array(sab, headerBytes, ringFrames);
    rightRing = new Float32Array(sab, headerBytes + ringFrames * Float32Array.BYTES_PER_ELEMENT, ringFrames);

    // Reset heads.
    Atomics.store(controlInts, WRITE_HEAD_IDX, 0);
    Atomics.store(controlInts, READ_HEAD_IDX, 0);
    Atomics.store(controlInts, RENDER_REQUEST_IDX, 0);
    Atomics.store(controlInts, FLUSH_GENERATION_IDX, 0);
    Atomics.store(controlInts, FLUSH_HEAD_IDX, 0);

    // Init WASM.
    const exports = initSync({ module: new WebAssembly.Module(wasmBytes) });
    memory = exports.memory;
    instance = new GrandBouleInstance(workerSampleRate, 64);
    running = true;
    waitingForDemand = false;
    demandWaitGeneration++;
    wasmBuffer = null;
    leftOutputView = null;
    rightOutputView = null;
    leftOutputPointer = -1;
    rightOutputPointer = -1;
    const lifecycleState = instance.lifecycle_state();
    Atomics.store(controlInts, SLEEP_HEAD_IDX, lifecycleState === LIFECYCLE_SLEEP ? 0 : -1);
    Atomics.store(controlInts, LIFECYCLE_IDX, lifecycleState);
    self.postMessage({ type: 'ready' });
    if (lifecycleState !== LIFECYCLE_SLEEP) {
        scheduleRender();
    }
}

function waitForRenderDemand(): void {
    if (!running || waitingForDemand || !controlInts) {
        return;
    }

    const expectedRequest = Atomics.load(controlInts, RENDER_REQUEST_IDX);
    const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
    const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
    const buffered = (writeHead - readHead) | 0;
    if (buffered < TARGET_AHEAD && ringFrames - buffered >= BLOCK_SIZE) {
        scheduleRender();
        return;
    }

    const generation = demandWaitGeneration;
    const waitResult = Atomics.waitAsync(controlInts, RENDER_REQUEST_IDX, expectedRequest);
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

function renderLoop(): void {
    if (!running || !instance || !controlInts || !leftRing || !rightRing || !memory) {
        return;
    }

    // Render as many blocks as needed to stay TARGET_AHEAD of the consumer,
    // using a bounded loop instead of recursion to avoid stack overflow.
    for (let index = 0; index < MAX_BLOCKS_PER_RENDER; index++) {
        const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
        const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
        const buffered = (writeHead - readHead) | 0;

        if (buffered >= TARGET_AHEAD || ringFrames - buffered < BLOCK_SIZE) {
            break; // Enough headroom or ring is full.
        }

        // Render one block.
        const leftPtr = instance.process(BLOCK_SIZE);
        const rightPtr = instance.get_right_ptr();
        const mem = memory.buffer;
        if (
            mem !== wasmBuffer ||
            leftPtr !== leftOutputPointer ||
            rightPtr !== rightOutputPointer ||
            !leftOutputView ||
            !rightOutputView
        ) {
            wasmBuffer = mem;
            leftOutputPointer = leftPtr;
            rightOutputPointer = rightPtr;
            leftOutputView = new Float32Array(mem, leftPtr, BLOCK_SIZE);
            rightOutputView = new Float32Array(mem, rightPtr, BLOCK_SIZE);
        }

        // Write into the ring (wrapping) and release-publish the new write head.
        const nextWriteHead = writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            writeHead,
            leftOutputView,
            rightOutputView,
            BLOCK_SIZE
        );

        const lifecycleState = instance.lifecycle_state();
        if (lifecycleState === LIFECYCLE_SLEEP) {
            Atomics.store(controlInts, SLEEP_HEAD_IDX, nextWriteHead);
            Atomics.store(controlInts, LIFECYCLE_IDX, lifecycleState);
            return;
        }
        Atomics.store(controlInts, SLEEP_HEAD_IDX, -1);
        Atomics.store(controlInts, LIFECYCLE_IDX, lifecycleState);

        // Atomics.pause is a Stage 3 proposal — cast to an extended type that includes it
        type AtomicsWithPause = typeof Atomics & { pause?: () => void };
        (Atomics as AtomicsWithPause).pause?.();
    }

    // Sleep without polling until the worklet consumes frames. Atomics.waitAsync
    // keeps the worker's message queue responsive to MIDI and control messages.
    waitForRenderDemand();
}

type GrandBouleDispatchMsg =
    | { type: 'noteOn'; midiNote: number; velocity: number; channel?: number }
    | {
          type: 'noteOff';
          midiNote: number;
          sampleFrame?: number;
          releaseVelocity?: number;
          channel?: number;
      }
    | {
          type: 'noteExpression';
          midiNote: number;
          channel: number;
          bendSemitones: number;
          pressure: number;
          slide: number;
      }
    | { type: 'param'; name: string; value: number }
    | { type: 'sustain'; position: number }
    | { type: 'unaCorda'; engaged: boolean }
    | { type: 'sostenuto'; engaged: boolean }
    | { type: 'noteOnMidi2'; midiNote: number; velocity16bit: number; pitchOffsetQ24: number }
    | { type: 'temperament'; index: number }
    | { type: 'loadAttackClip'; key: number; samples: Float32Array }
    | { type: 'allNotesOff' };

type GrandBouleWorkerMsg =
    | { type: 'init'; wasmBytes: ArrayBuffer; sab: SharedArrayBuffer; sampleRate: number }
    | { type: 'stop' }
    | GrandBouleDispatchMsg;

function dispatch(msg: GrandBouleDispatchMsg): void {
    if (!instance || !controlInts) {
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
            instance.all_notes_off();
            Atomics.store(controlInts, FLUSH_HEAD_IDX, Atomics.load(controlInts, WRITE_HEAD_IDX));
            Atomics.add(controlInts, FLUSH_GENERATION_IDX, 1);
            break;
    }

    const lifecycleState = instance.lifecycle_state();
    if (lifecycleState === LIFECYCLE_SLEEP) {
        Atomics.store(controlInts, SLEEP_HEAD_IDX, Atomics.load(controlInts, WRITE_HEAD_IDX));
        Atomics.store(controlInts, LIFECYCLE_IDX, lifecycleState);
        return;
    }
    Atomics.store(controlInts, LIFECYCLE_IDX, lifecycleState);
    scheduleRender();
}

self.onmessage = ({ data }: MessageEvent<GrandBouleWorkerMsg>): void => {
    if (data.type === 'init') {
        initEngine(data.wasmBytes, data.sab, data.sampleRate);
    } else if (data.type === 'stop') {
        running = false;
        renderScheduled = false;
        waitingForDemand = false;
        demandWaitGeneration++;
        if (controlInts) {
            Atomics.add(controlInts, RENDER_REQUEST_IDX, 1);
            Atomics.notify(controlInts, RENDER_REQUEST_IDX);
        }
    } else {
        dispatch(data);
    }
};
