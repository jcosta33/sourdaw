// @ts-nocheck
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
 *   ← { type: 'noteOn', midiNote, velocity }
 *   ← { type: 'noteOff', midiNote }
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
};

let instance: InstanceType<typeof GrandBouleInstance> | null = null;
let memory: WebAssembly.Memory | null = null;
let running = false;

// SAB layout: [writeHead: Int32, readHead: Int32, leftRing: Float32[], rightRing: Float32[]]
let controlInts: Int32Array | null = null;
let leftRing: Float32Array | null = null;
let rightRing: Float32Array | null = null;
let ringFrames = 0;

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;

function initEngine(wasmBytes: ArrayBuffer, sab: SharedArrayBuffer, sampleRate: number): void {
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
    instance = new GrandBouleInstance(sampleRate, 64);
    running = true;
    self.postMessage({ type: 'ready' });
    scheduleRender();
}

function renderLoop(): void {
    if (!running || !instance || !controlInts || !leftRing || !rightRing || !memory) {return;}

    // Render as many blocks as needed to stay TARGET_AHEAD of the consumer,
    // using a bounded loop instead of recursion to avoid stack overflow.
    const maxBlocksPerTick = Math.ceil(TARGET_AHEAD / BLOCK_SIZE) + 1;

    for (let i = 0; i < maxBlocksPerTick; i++) {
        const writeHead = Atomics.load(controlInts, WRITE_HEAD_IDX);
        const readHead = Atomics.load(controlInts, READ_HEAD_IDX);
        const buffered = writeHead - readHead;

        if (buffered >= TARGET_AHEAD || ringFrames - buffered < BLOCK_SIZE) {
            break; // Enough headroom or ring is full.
        }

        // Render one block.
        const leftPtr = instance.process(BLOCK_SIZE);
        const rightPtr = instance.get_right_ptr();
        const mem = memory.buffer;
        const leftSrc = new Float32Array(mem, leftPtr, BLOCK_SIZE);
        const rightSrc = new Float32Array(mem, rightPtr, BLOCK_SIZE);

        // Write into ring buffer (wrapping).
        const offset = writeHead % ringFrames;
        const firstChunk = Math.min(BLOCK_SIZE, ringFrames - offset);
        const secondChunk = BLOCK_SIZE - firstChunk;

        leftRing.set(leftSrc.subarray(0, firstChunk), offset);
        rightRing.set(rightSrc.subarray(0, firstChunk), offset);
        if (secondChunk > 0) {
            leftRing.set(leftSrc.subarray(firstChunk), 0);
            rightRing.set(rightSrc.subarray(firstChunk), 0);
        }

        Atomics.store(controlInts, WRITE_HEAD_IDX, writeHead + BLOCK_SIZE);
        Atomics.pause?.();
    }

    // Yield to the event loop so pending MIDI messages can be dispatched,
    // then resume rendering via the MessageChannel macrotask.
    scheduleRender();
}

function dispatch(msg: Record<string, unknown>): void {
    if (!instance) {return;}
    switch (msg.type) {
        case 'noteOn':
            instance.note_on(msg.midiNote as number, msg.velocity as number, msg.sampleFrame as number);
            break;
        case 'noteOff':
            instance.note_off(msg.midiNote as number, msg.sampleFrame as number);
            break;
        case 'param':
            instance.set_param(PARAM_MAP[msg.name as string] ?? (msg.name as string), msg.value as number);
            break;
        case 'sustain':
            instance.set_sustain(msg.position as number);
            break;
        case 'unaCorda':
            instance.set_una_corda(msg.engaged as boolean);
            break;
        case 'sostenuto':
            instance.set_sostenuto(msg.engaged as boolean);
            break;
        case 'noteOnMidi2':
            instance.note_on_midi2(msg.midiNote as number, msg.velocity16bit as number, msg.pitchOffsetQ24 as number);
            break;
        case 'temperament':
            instance.set_temperament(msg.index as number);
            break;
        case 'loadAttackClip':
            instance.load_attack_clip(msg.key as number, msg.samples as Float32Array);
            break;
        case 'allNotesOff':
            instance.all_notes_off();
            break;
    }
}

self.onmessage = ({ data }: MessageEvent): void => {
    const msg = data as Record<string, unknown>;
    if (msg.type === 'init') {
        initEngine(msg.wasmBytes as ArrayBuffer, msg.sab as SharedArrayBuffer, msg.sampleRate as number);
    } else if (msg.type === 'stop') {
        running = false;
    } else {
        dispatch(msg);
    }
};
