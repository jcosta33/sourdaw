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
 * The threshold is not a performance target anyone tuned. It is the named
 * blocker from the spec: over `RENDER_TIMEOUT_MULTIPLIER` and the offline
 * transport is not viable as built, and the answer becomes block batching rather
 * than this.
 *
 * **The explicit `MEASUREMENT_TIMEOUT_MS` is load-bearing, not decoration.**
 * Without it the case inherits vitest's 5000 ms default, which is ~2.5x realtime
 * for two seconds of audio — so the ceiling that actually fires is a quarter of
 * the budget this claims to assert, and it fires as `Test timed out in 5000ms`
 * rather than as the property. That is a flaky test wearing a product assertion's
 * clothes, and it was: one full-suite run went red at 2.567x on a busy machine.
 * The timeout is set far above any plausible render so the assertion below is the
 * one that decides.
 */

const HOST_SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
/** Full polyphony: `GrandBouleInstance` is constructed with 64 voices. */
const VOICE_COUNT = 64;
/** Lowest MIDI note of an 88-key piano; 64 voices from here stay in range. */
const LOWEST_PIANO_NOTE = 21;
/** Long enough for the measurement to survive one scheduler hiccup. */
const AUDIO_SECONDS = 2;

/**
 * Well past `RENDER_TIMEOUT_MULTIPLIER * AUDIO_SECONDS` (20 s), plus room for
 * wasm compilation and a loaded CI box. Nothing about the product is expressed
 * here — its only job is to stay out of the way of the assertion.
 */
const MEASUREMENT_TIMEOUT_MS = 120_000;

const WASM_PATH = resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm');

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const processorRegistry = new Map<string, new (...args: unknown[]) => ProcessorLike>();
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
        vi.stubGlobal('registerProcessor', (name: string, ctor: new (...args: unknown[]) => ProcessorLike) => {
            processorRegistry.set(name, ctor);
        });

        await import('../grandBouleOfflineProcessor');
        const Processor = processorRegistry.get('grand-boule-offline-processor');
        if (!Processor) {
            throw new Error('grand-boule-offline-processor was not registered');
        }

        // Compile where the real node factory does: outside the processor and
        // once, before constructing the worklet instance.
        const wasmBytes = readFileSync(WASM_PATH);
        const wasmModule = new WebAssembly.Module(
            wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
        );
        const inner: HarnessPort = { onmessage: null, postMessage: vi.fn() };
        pendingProcessorPort = inner;
        try {
            processor = new Processor({ processorOptions: { wasmModule } });
        } finally {
            pendingProcessorPort = null;
        }
        port = inner;

        port.onmessage?.({ data: { type: 'init' } } as MessageEvent);
    });

    it(
        'renders faster than the timeout multiplier allows',
        async ({ annotate }) => {
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

            // Annotated, not logged. `console.info` from a *passing* test is
            // swallowed by the suite's `--silent=passed-only`, so the figure would
            // only ever appear on the run where it no longer matters. An annotation
            // is reported for a green test, which is the only way a number in a
            // commit message is reproducible by the person reading it.
            const summary =
                `${VOICE_COUNT} voices, ${AUDIO_SECONDS}s of audio in ${elapsedSeconds.toFixed(3)}s wall clock ` +
                `= ${realtimeRatio.toFixed(3)}x realtime (budget ${RENDER_TIMEOUT_MULTIPLIER}x)`;
            await annotate(summary, 'notice');

            // `peak` guards the measurement itself: an engine that produced silence
            // renders very fast and would sail past a timing assertion alone. Note
            // what it does *not* prove — the output buffer is reused across quanta,
            // so a fault partway through leaves the last good block in it and this
            // still passes. It catches the case it is here for, a device that never
            // came up at all, and no more.
            expect({
                producedAudio: peak > 0.001,
                withinBudget: realtimeRatio < RENDER_TIMEOUT_MULTIPLIER,
            }).toEqual({ producedAudio: true, withinBudget: true });
        },
        MEASUREMENT_TIMEOUT_MS
    );
});
