/**
 * ToasterNode — AudioWorkletNode wrapper for the Toaster drum machine.
 *
 * Same pattern as FermenterNode: caches the compiled WASM module, resumes AudioContext,
 * provides noteOn/noteOff/setParam/setPadParam via MessagePort.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import toasterProcessorUrl from '../services/toasterProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
const TOASTER_PAD_COUNT = 16;
export const TOASTER_AUTOMATION_PARAM_IDS: Readonly<Record<string, number>> = {
    masterGain: 0,
    reverbMix: 1,
    delayMix: 2,
};

type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};
function isContiguousAutomationSchedule(segments: readonly OfflineAutomationSegment[]): boolean {
    if (segments.length === 0 || segments[0]?.startFrame !== 0) {
        return false;
    }
    return segments.every((segment, index) => {
        const previous = segments[index - 1];
        return (
            Number.isInteger(segment.startFrame) &&
            Number.isInteger(segment.endFrame) &&
            segment.startFrame >= 0 &&
            segment.endFrame >= segment.startFrame &&
            (index === 0 || segment.startFrame === previous?.endFrame) &&
            Number.isFinite(segment.startValue) &&
            Number.isFinite(segment.endValue)
        );
    });
}

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
    outputNode: GainNode;
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
    scheduleHit: (input: ScheduleToasterHitInput) => void;
    cancelScheduled: () => void;
    allNotesOff: () => void;
    setFillActive: (active: boolean) => void;
    setParam: (name: string, value: number) => void;
    acceptsScheduledParam: (name: string) => boolean;
    scheduleParam: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setPadParam: (pad: number, name: string, value: number) => void;
    setPadDryRouted: (pad: number, routed: boolean) => void;
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

export async function createToasterNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal
): Promise<ToasterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, toasterProcessorUrl), signal);
    const wasmModule = await raceAbortSignal(fetchWasmModule(wasmUrl ?? DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'toaster-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1 + TOASTER_PAD_COUNT,
        outputChannelCount: Array.from({ length: 1 + TOASTER_PAD_COUNT }, () => 2),
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });
    const outputNode = ctx.createGain();
    outputNode.gain.value = 1;
    node.connect(outputNode, 0, 0);
    const padOutputGains = Array.from({ length: TOASTER_PAD_COUNT }, (_, pad) => {
        const gainNode = ctx.createGain();
        gainNode.gain.value = 1;
        node.connect(gainNode, pad + 1, 0);
        return gainNode;
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'ToasterNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        outputNode,
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
            if (!Number.isFinite(value)) {
                return;
            }
            node.port.postMessage({ type: 'param', name, value });
        },
        acceptsScheduledParam(name: string) {
            return Object.hasOwn(TOASTER_AUTOMATION_PARAM_IDS, name);
        },
        scheduleParam(name: string, segments: readonly OfflineAutomationSegment[]) {
            const paramId = Object.hasOwn(TOASTER_AUTOMATION_PARAM_IDS, name)
                ? TOASTER_AUTOMATION_PARAM_IDS[name]
                : undefined;
            const valid = paramId !== undefined && isContiguousAutomationSchedule(segments);
            if (valid) {
                node.port.postMessage({ type: 'paramAutomation', paramId, segments });
            }
        },
        setPadParam(pad: number, name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'padParam', pad, name, value });
            }
        },
        setPadDryRouted(pad: number, routed: boolean) {
            if (Number.isInteger(pad) && pad >= 0 && pad < TOASTER_PAD_COUNT) {
                node.port.postMessage({ type: 'padDryRouted', pad, routed });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
        },
        connectPadOutput(pad: number, dest: AudioNode) {
            if (Number.isInteger(pad) && pad >= 0 && pad < TOASTER_PAD_COUNT) {
                padOutputGains[pad]?.connect(dest);
            }
        },
        disconnectPadOutput(pad: number, dest: AudioNode) {
            if (!Number.isInteger(pad) || pad < 0 || pad >= TOASTER_PAD_COUNT) {
                return;
            }
            try {
                padOutputGains[pad]?.disconnect(dest);
            } catch {
                // The output edge may already have been removed by device teardown.
            }
        },
        connect(dest: AudioNode) {
            outputNode.connect(dest);
        },
        disconnect() {
            try {
                outputNode.disconnect();
            } catch {
                // ignore
            }
        },
        destroy() {
            node.port.postMessage({ type: 'resetPadDryRouting' });
            for (const gainNode of padOutputGains) {
                try {
                    gainNode.disconnect();
                } catch {
                    // The pad output may already have been disconnected.
                }
            }
            try {
                outputNode.disconnect();
            } catch {
                // The parent output may already be detached from the track graph.
            }
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
