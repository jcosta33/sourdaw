/**
 * Engine class: NativeDspNode
 *
 * Wraps an AudioWorkletNode that hosts a Rust/WASM DSP plugin instance.
 * Used for native-* device types (native-eq, native-compressor, etc.).
 */

import nativeDspProcessorUrl from '../services/nativeDspProcessor.ts?worker&url';

// WASM binary URL for passing to the worklet
const wasmUrl = new URL('../wasm/audio_core_bg.wasm', import.meta.url).href;

export type NativeDspPluginType = 'eq' | 'compressor' | 'limiter' | 'reverb' | 'delay' | 'gate' | 'gain';

export const NATIVE_DSP_DEVICE_TYPES: Record<string, NativeDspPluginType> = {
    'native-eq': 'eq',
    'native-compressor': 'compressor',
    'native-limiter': 'limiter',
    'native-reverb': 'reverb',
    'native-delay': 'delay',
    'native-gate': 'gate',
    'native-gain': 'gain',
};

export function isNativeDspDevice(deviceType: string): boolean {
    return deviceType in NATIVE_DSP_DEVICE_TYPES;
}

let workletRegistered = false;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    if (workletRegistered) {
        return;
    }
    await ctx.audioWorklet.addModule(nativeDspProcessorUrl);
    workletRegistered = true;
}

export type NativeDspNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    ready: Promise<void>;
};

/**
 * Create a native DSP AudioWorkletNode for the given plugin type.
 * Returns immediately with unconnected nodes; call `result.ready` to wait for WASM init.
 */
export async function createNativeDspNode(
    ctx: BaseAudioContext,
    pluginType: NativeDspPluginType
): Promise<NativeDspNodeResult> {
    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'native-dsp-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('NativeDspNode init timeout')), 10000);
        node.port.onmessage = (e) => {
            if (e.data.type === 'ready') {
                clearTimeout(timeout);
                resolve();
            } else if (e.data.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            }
        };
    });

    // Send init command with WASM URL and plugin type
    node.port.postMessage({
        type: 'init',
        wasmUrl,
        pluginType,
    });

    const setParam = (name: string, value: number): void => {
        node.port.postMessage({ type: 'set_param', name, value });
    };

    const setBypass = (bypassed: boolean): void => {
        node.port.postMessage({ type: 'set_bypass', bypassed });
    };

    return { workletNode: node, setParam, setBypass, ready: readyPromise };
}
