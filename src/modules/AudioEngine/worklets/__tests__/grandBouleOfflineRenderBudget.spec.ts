import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeAll, vi } from 'vitest';

import { RENDER_TIMEOUT_MULTIPLIER } from '../../useCases/offlineRender/constants';

/**
 * Can a 64-voice Grand Boule render finish inside the export timeout?
 *
 * `renderTrackSubgraphOffline` budgets `RENDER_TIMEOUT_MULTIPLIER` seconds of
 * wall clock per second of audio. Moving the engine into the worklet for offline
 * renders removes the ring's back-pressure, so nothing paces the DSP any more —
 * it runs as fast as the machine allows, and how fast that is stops being a
 * theoretical question and becomes the thing that decides whether a user's export
 * dies at the timeout.
 *
 * This measures it. Real `daw-dsp` WASM off disk, the real
 * `grandBouleOfflineProcessor`, real 128-frame quanta, 64 voices held for the
 * whole run — the render's actual inner loop. What it does not include is the
 * surrounding Web Audio graph (a handful of gain nodes) and the per-second
 * suspend round trips, neither of which is Grand Boule's cost and both of which
 * are small next to a physical-model piano.
 *
 * The threshold below is not a performance target anyone tuned. It is the named
 * blocker from the spec: over `RENDER_TIMEOUT_MULTIPLIER` and the offline
 * transport is not viable as built, and the answer becomes block batching rather
 * than this. The margin is deliberately the real budget, so this fails when the
 * product breaks rather than when a laptop is busy.
 */

const HOST_SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
/** Full polyphony: `GrandBouleInstance` is constructed with 64 voices. */
const VOICE_COUNT = 64;
/** Lowest MIDI note of an 88-key piano; 64 voices from here stay in range. */
const LOWEST_PIANO_NOTE = 21;
/** Long enough for the measurement to survive one scheduler hiccup. */
const AUDIO_SECONDS = 2;

const WASM_PATH = resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm');

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const processorRegistry = new Map<string, new () => ProcessorLike>();
let pendingProcessorPort: HarnessPort | null = null;
let harnessFrame = 0;

class AudioWorkletProcessorShim {
    readonly port: HarnessPort;
    constructor() {
        if (!pendingProcessorPort) {
            throw new Error('AudioWorkletProcessorShim constructed outside the harness');
        }
        this.port = pendingProcessorPort;
    }
}

describe('a 64-voice Grand Boule offline render fits the export budget', () => {
    let processor: ProcessorLike;
    let port: HarnessPort;

    beforeAll(async () => {
        Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
        Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => HOST_SAMPLE_RATE });
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, ctor: new () => ProcessorLike) => {
            processorRegistry.set(name, ctor);
        });

        await import('../grandBouleOfflineProcessor');
        const Processor = processorRegistry.get('grand-boule-offline-processor');
        if (!Processor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }

        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        try {
            processor = new Processor();
        } finally {
            pendingProcessorPort = null;
        }
        port = inner;

        // The genuine article: the same bytes the app fetches at runtime.
        const wasmBytes = readFileSync(WASM_PATH);
        port.onmessage?.({
            data: {
                type: 'init',
                // Sliced out of the pooled Node buffer: `readFileSync` can hand
                // back a view into a shared allocation, and the whole pool is not
                // a wasm module.
                wasmBytes: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
            },
        } as MessageEvent);
    });

    it('renders faster than the timeout multiplier allows', () => {
        for (let voice = 0; voice < VOICE_COUNT; voice++) {
            port.onmessage?.({
                data: { type: 'noteOn', midiNote: LOWEST_PIANO_NOTE + voice, velocity: 0.9 },
            } as MessageEvent);
        }

        const quanta = Math.round((AUDIO_SECONDS * HOST_SAMPLE_RATE) / QUANTUM_FRAMES);
        const left = new Float32Array(QUANTUM_FRAMES);
        const right = new Float32Array(QUANTUM_FRAMES);

        // One warm-up block so the measurement excludes wasm tier-up on the very
        // first call rather than attributing it to the render.
        processor.process([], [[left, right]]);

        let peak = 0;
        const startedAt = performance.now();
        for (let quantum = 0; quantum < quanta; quantum++) {
            harnessFrame = quantum * QUANTUM_FRAMES;
            processor.process([], [[left, right]]);
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const magnitude = Math.abs(left[index] ?? 0);
                if (magnitude > peak) {
                    peak = magnitude;
                }
            }
        }
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        const realtimeRatio = elapsedSeconds / AUDIO_SECONDS;

        // Reported either way: a number nobody can read is not a measurement.
        console.info(
            `[grand-boule] 64 voices, ${AUDIO_SECONDS}s of audio in ${elapsedSeconds.toFixed(3)}s wall clock ` +
                `= ${realtimeRatio.toFixed(3)}x realtime (budget ${RENDER_TIMEOUT_MULTIPLIER}x)`
        );

        // `peak` guards the measurement itself: an engine that produced silence
        // would render very fast and pass a timing assertion alone.
        expect({
            producedAudio: peak > 0.001,
            withinBudget: realtimeRatio < RENDER_TIMEOUT_MULTIPLIER,
        }).toEqual({ producedAudio: true, withinBudget: true });
    });
});
