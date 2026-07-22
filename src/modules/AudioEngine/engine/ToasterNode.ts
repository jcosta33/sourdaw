/**
 * ToasterNode — AudioWorkletNode wrapper for the Toaster drum machine.
 *
 * Same pattern as FermenterNode: caches WASM binary, resumes AudioContext,
 * provides noteOn/noteOff/setParam/setPadParam via MessagePort.
 */

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from '#/infra/audioWorklet/workletInitShared';

import toasterProcessorUrl from '../services/toasterProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
const TOASTER_PAD_COUNT = 16;

type ScheduleToasterHitInput = {
    pad: number;
    velocity: number;
    midiNote?: number;
    sampleFrame: number;
    padParams: Array<{ name: string; value: number }>;
    restoreEngineType?: number;
    fillCondition?: 'fill' | 'not-fill';
};

export type ToasterNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
    scheduleHit: (input: ScheduleToasterHitInput) => void;
    cancelScheduled: () => void;
    allNotesOff: () => void;
    setFillActive: (active: boolean) => void;
    setParam: (name: string, value: number) => void;
    setPadParam: (pad: number, name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connectPadOutput?: (pad: number, dest: AudioNode) => void;
    disconnectPadOutput?: (pad: number, dest: AudioNode) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isToasterDevice(deviceType: string): boolean {
    return deviceType === 'toaster';
}

export async function createToasterNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<ToasterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, toasterProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'toaster-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1 + TOASTER_PAD_COUNT,
        outputChannelCount: Array.from({ length: 1 + TOASTER_PAD_COUNT }, () => 2),
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'ToasterNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(pad: number, velocity: number, midiNote: number = 60, sampleFrame?: number) {
            if (!bypassed) {
                node.port.postMessage({
                    type: 'noteOn',
                    pad,
                    velocity: Math.min(127, Math.max(0, velocity)),
                    note: midiNote,
                    sampleFrame,
                });
            }
        },
        noteOff(pad: number, sampleFrame?: number) {
            node.port.postMessage({ type: 'noteOff', pad, sampleFrame });
        },
        scheduleHit({ pad, velocity, midiNote = 60, sampleFrame, padParams, restoreEngineType, fillCondition }) {
            if (bypassed) {
                return;
            }
            node.port.postMessage({
                type: 'scheduledHit',
                pad,
                velocity: Math.min(127, Math.max(0, velocity)),
                note: midiNote,
                sampleFrame,
                padParams,
                restoreEngineType,
                fillCondition,
            });
        },
        cancelScheduled() {
            node.port.postMessage({ type: 'cancelScheduled' });
        },
        allNotesOff() {
            node.port.postMessage({ type: 'allNotesOff' });
        },
        setFillActive(active) {
            node.port.postMessage({ type: 'fillState', active });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setPadParam(pad: number, name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'padParam', pad, name, value });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
        },
        connectPadOutput(pad: number, dest: AudioNode) {
            if (Number.isInteger(pad) && pad >= 0 && pad < TOASTER_PAD_COUNT) {
                node.connect(dest, pad + 1, 0);
            }
        },
        disconnectPadOutput(pad: number, dest: AudioNode) {
            if (!Number.isInteger(pad) || pad < 0 || pad >= TOASTER_PAD_COUNT) {
                return;
            }
            try {
                node.disconnect(dest, pad + 1, 0);
            } catch {
                // The output edge may already have been removed by device teardown.
            }
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {
                // ignore
            }
        },
        destroy() {
            try {
                node.disconnect();
            } catch {
                // ignore
            }
            node.port.close();
        },
        ready: readyPromise,
    };
}
