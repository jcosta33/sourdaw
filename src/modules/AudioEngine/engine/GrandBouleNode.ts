/**
 * GrandBouleNode — double-buffered AudioWorkletNode for the Grand Boule piano.
 *
 * Architecture:
 *   Main thread  →  Web Worker (WASM engine)  →  SAB ring buffer  →  AudioWorklet (consumer)
 *
 * The WASM physical-modeling engine runs on a dedicated Web Worker that
 * renders ahead into a SharedArrayBuffer. The AudioWorklet process() just
 * copies from the ring buffer — microseconds of work, zero risk of
 * real-time underrun from DSP load.
 *
 * MIDI and control messages are routed to the Worker, not the worklet.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered } from '#/infra/audioWorklet/workletInitShared';

import grandBouleProcessorUrl from '../services/grandBouleProcessor.ts?worker&url';

import { dropoutCounters } from './dropoutCounter';
import { requireSharedArrayBuffer } from './pluginHostingErrors';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

/** Ring buffer: 8192 stereo frames ≈ 170 ms at 48 kHz. */
const RING_FRAMES = 8192;
const HEADER_BYTES = 2 * Int32Array.BYTES_PER_ELEMENT; // writeHead + readHead
const SAB_BYTES = HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT;

/**
 * Grand Boule uses its own fetcher (not the shared cache) because it appends
 * a DEV-only cache-buster query string to pick up freshly-rebuilt WASM during
 * hot development of the physical-modeling engine.
 */
let cachedGrandBouleWasm: ArrayBuffer | null = null;
async function fetchGrandBouleWasm(url: string): Promise<ArrayBuffer> {
    if (cachedGrandBouleWasm) {
        return cachedGrandBouleWasm;
    }
    const fetchUrl = import.meta.env.DEV ? `${url}?t=${Date.now()}` : url;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch Grand Boule WASM: ${response.status}`);
    }
    cachedGrandBouleWasm = await response.arrayBuffer();
    return cachedGrandBouleWasm;
}

export type GrandBouleNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (midiNote: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) => void;
    /**
     * MPE per-note expression (audit MD-2). Grand Boule sounds
     * `bendSemitones` only — its ringing modal strings are retuned in
     * place; `pressure` and `slide` have no counterpart on a struck string
     * and are dropped at the engine. The expression registry advertises
     * pitch bend alone for this device, so the editor never offers them.
     */
    noteExpression: (
        midiNote: number,
        channel: number,
        bendSemitones: number,
        pressure: number,
        slide: number,
        sampleFrame?: number
    ) => void;
    setParam: (name: string, value: number) => void;
    setSustain: (position: number) => void;
    setUnaCorda: (engaged: boolean) => void;
    setSostenuto: (engaged: boolean) => void;
    noteOnMidi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
    setTemperament: (index: number) => void;
    loadAttackClip: (key: number, samples: Float32Array) => void;
    allNotesOff: () => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isGrandBouleDevice(deviceType: string): boolean {
    return deviceType === 'grand-boule';
}

export async function createGrandBouleNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal
): Promise<GrandBouleNodeResult> {
    // Fail fast before doing any AudioContext / worklet / WASM work when
    // SharedArrayBuffer is unavailable. The typed error is caught in
    // `buildDeviceChain` and mapped to a user-visible notification.
    requireSharedArrayBuffer('Grand Boule');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, grandBouleProcessorUrl), signal);
    const wasmBytes = await raceAbortSignal(fetchGrandBouleWasm(wasmUrl ?? DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'grand-boule-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    // Create SAB ring buffer shared between Worker and AudioWorklet.
    // Requires cross-origin isolation (COOP + COEP headers) — guarded above.
    const sab = new SharedArrayBuffer(SAB_BYTES);

    // Create the engine Worker.
    const engineWorker = new Worker(new URL('../workers/grandBouleEngineWorker.ts', import.meta.url), {
        type: 'module',
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'GrandBouleNode' });
    engineWorker.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'ready') {
            // Now init the worklet side with the same SAB, plus the shared
            // dropout counters so ring starvation is tallied instead of silently
            // producing silence (audit RT-10).
            node.port.postMessage({ type: 'init', sab, dropoutSab: dropoutCounters.getSab() });
        }
    };
    const readyPromise = handshake.promise;

    // Send the preloaded WASM bytes + SAB to the engine worker.
    const copy = wasmBytes.slice(0);
    engineWorker.postMessage({ type: 'init', wasmBytes: copy, sab, sampleRate: ctx.sampleRate }, [copy]);

    /** Post a message to the engine worker (not the AudioWorklet). */
    const post = (msg: Record<string, unknown>): void => {
        engineWorker.postMessage(msg);
    };

    return {
        workletNode: node,
        noteOn(midiNote: number, velocity: number, sampleFrame?: number, channel?: number) {
            if (!bypassed) {
                post({ type: 'noteOn', midiNote, velocity, sampleFrame, channel });
            }
        },
        // `channel` narrows the release to one MPE member channel; omit it
        // and every voice at that pitch is released, as before.
        noteOff(midiNote: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) {
            post({
                type: 'noteOff',
                midiNote,
                sampleFrame,
                releaseVelocity: releaseVelocity ?? 0,
                channel,
            });
        },
        noteExpression(
            midiNote: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) {
            if (midiNote < 0 || midiNote > 127) {
                return;
            }
            if (!Number.isFinite(bendSemitones) || !Number.isFinite(pressure) || !Number.isFinite(slide)) {
                return;
            }
            post({
                type: 'noteExpression',
                midiNote,
                channel,
                bendSemitones,
                pressure,
                slide,
                sampleFrame,
            });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                post({ type: 'param', name, value });
            }
        },
        setSustain(position: number) {
            post({ type: 'sustain', position });
        },
        setUnaCorda(engaged: boolean) {
            post({ type: 'unaCorda', engaged });
        },
        setSostenuto(engaged: boolean) {
            post({ type: 'sostenuto', engaged });
        },
        noteOnMidi2(midiNote: number, velocity16bit: number, pitchOffsetQ24: number) {
            if (!bypassed) {
                post({ type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 });
            }
        },
        setTemperament(index: number) {
            post({ type: 'temperament', index });
        },
        loadAttackClip(key: number, samples: Float32Array) {
            const buf = new Float32Array(samples);
            post({ type: 'loadAttackClip', key, samples: buf });
        },
        allNotesOff() {
            post({ type: 'allNotesOff' });
        },
        setBypass(state: boolean) {
            // Only gates *new* noteOn. Releasing voices already held on bypass
            // entry is owned by TrackNode.updateBypass via controller.allNotesOff
            // (wired above) — no in-node post, or the release would run twice.
            bypassed = state;
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch (error) {
                console.error('[GrandBouleNode] Disconnect failed:', error);
            }
        },
        destroy() {
            try {
                node.disconnect();
            } catch (error) {
                console.error('[GrandBouleNode] Disconnect failed during destroy:', error);
            }
            node.port.close();
            engineWorker.postMessage({ type: 'stop' });
            engineWorker.terminate();
        },
        ready: readyPromise,
    };
}
