import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import processorUrl from '../services/transientShaperProcessor.ts?worker&url';

const RESET_FAULT_EPOCH = 16_777_215;
const DISPOSE_TIMEOUT_MS = 1000;
const frameTimeBits = new DataView(new ArrayBuffer(8));

type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

function frameTime(frame: number, sampleRate: number): number {
    const seconds = frame / sampleRate;
    if (seconds * sampleRate <= frame) {
        return seconds;
    }
    // Chromium rounds an event above its integer frame up to the next sample.
    frameTimeBits.setFloat64(0, seconds);
    frameTimeBits.setBigUint64(0, frameTimeBits.getBigUint64(0) - 1n);
    return frameTimeBits.getFloat64(0);
}

export function isTransientShaperDevice(type: string): boolean {
    return type === 'transient-shaper';
}

export function isTransientShaperParameter(name: string): boolean {
    return name === 'attackGain' || name === 'sustainGain';
}

function bounded(value: number): number {
    return Math.min(2, Math.max(0, value));
}

function createGainControls(context: BaseAudioContext, param: (name: string) => AudioParam | undefined) {
    const time = (frame?: number): number => {
        if (frame === undefined) {
            return context.currentTime;
        }
        return Math.max(context.currentTime, frameTime(frame, context.sampleRate));
    };
    return {
        setParam(name: string, value: number, sampleFrame?: number): void {
            if (
                !Number.isFinite(value) ||
                (sampleFrame !== undefined && (!Number.isSafeInteger(sampleFrame) || sampleFrame < 0))
            ) {
                return;
            }
            param(name)?.setValueAtTime(bounded(value), time(sampleFrame));
        },
        acceptsScheduledParam: isTransientShaperParameter,
        scheduleParam(name: string, segments: readonly OfflineAutomationSegment[]): void {
            const target = param(name);
            if (!target) {
                return;
            }
            for (const segment of segments) {
                if (
                    !Number.isSafeInteger(segment.startFrame) ||
                    !Number.isSafeInteger(segment.endFrame) ||
                    segment.startFrame < 0 ||
                    segment.endFrame < segment.startFrame ||
                    !Number.isFinite(segment.startValue) ||
                    !Number.isFinite(segment.endValue)
                ) {
                    continue;
                }
                target.setValueAtTime(bounded(segment.startValue), time(segment.startFrame));
                if (segment.endFrame > segment.startFrame) {
                    target.linearRampToValueAtTime(bounded(segment.endValue), time(segment.endFrame));
                }
            }
        },
    };
}

export async function createTransientShaperNode(
    context: BaseAudioContext,
    signal?: AbortSignal,
    onRuntimeFailure?: (message: string) => void
) {
    if (typeof AudioContext !== 'undefined' && context instanceof AudioContext && context.state === 'suspended') {
        await raceAbortSignal(context.resume(), signal);
    }
    await raceAbortSignal(ensureWorkletRegistered(context, processorUrl), signal);
    const lease = await raceAbortSignal(
        fetchWasmModule({ ctx: context, bundleId: 'daw-dsp', url: '/wasm/daw-dsp/daw_dsp_bg.wasm', signal }),
        signal
    );
    let workletNode: AudioWorkletNode;
    try {
        signal?.throwIfAborted();
        workletNode = new AudioWorkletNode(context, 'transient-shaper-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            processorOptions: { wasmModule: lease.module },
        });
        lease.commit();
    } catch (error) {
        lease.release();
        throw error;
    }
    return createTransientShaperController(context, workletNode, signal, onRuntimeFailure);
}

function createTransientShaperController(
    context: BaseAudioContext,
    workletNode: AudioWorkletNode,
    signal?: AbortSignal,
    onRuntimeFailure?: (message: string) => void
) {
    let destroyed = false;
    let failed = false;
    let bypassed = false;
    const resetParam = workletNode.parameters.get('_resetEpoch');
    if (!resetParam) {
        workletNode.disconnect();
        workletNode.port.close();
        throw new Error('Transient Shaper reset AudioParam is missing');
    }
    const handshake = createReadyHandshake({ pluginName: 'Transient Shaper' });
    let epoch = resetParam.value;
    let disposeTimeout: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string): void => {
        if (failed || destroyed) {
            return;
        }
        failed = true;
        handshake.reject(new Error(message));
        onRuntimeFailure?.(message);
        destroy();
    };
    const close = (): void => {
        clearTimeout(disposeTimeout);
        workletNode.port.close();
        signal?.removeEventListener('abort', destroy);
    };
    const destroy = (): void => {
        if (destroyed) {
            return;
        }
        destroyed = true;
        handshake.reject(new Error('Transient Shaper destroyed'));
        workletNode.disconnect();
        workletNode.port.postMessage({ type: 'dispose' });
        disposeTimeout = setTimeout(close, DISPOSE_TIMEOUT_MS);
    };
    signal?.addEventListener('abort', destroy, { once: true });
    workletNode.onprocessorerror = () => fail('Transient Shaper processor failed');
    workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (data && typeof data === 'object' && 'type' in data) {
            if (data.type === 'disposed') {
                close();
                return;
            }
            if (data.type === 'error') {
                fail('message' in data ? String(data.message) : 'Transient Shaper initialization failed');
                return;
            }
        }
        if (!destroyed && !failed) {
            handshake.onMessage(event);
        }
    };
    const param = (name: string): AudioParam | undefined => {
        if (destroyed || failed || !isTransientShaperParameter(name)) {
            return undefined;
        }
        return workletNode.parameters.get(name);
    };
    const gainControls = createGainControls(context, param);
    workletNode.port.postMessage({ type: 'init' });
    return {
        workletNode,
        ready: handshake.promise.catch((error: unknown) => {
            destroy();
            throw error;
        }),
        ...gainControls,
        setBypass(value: boolean): void {
            if (destroyed || failed || value === bypassed) {
                return;
            }
            bypassed = value;
            epoch++;
            // A scheduled currentTime can round into the next quantum. Publish
            // the intrinsic value too, with no older private timeline to override it.
            resetParam.cancelScheduledValues(0);
            resetParam.value = epoch;
            if (epoch === RESET_FAULT_EPOCH) {
                fail('Transient Shaper reset epoch exhausted');
            }
        },
        destroy,
    };
}
