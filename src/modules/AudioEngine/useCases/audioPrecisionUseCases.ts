/**
 * 64-bit Floating-Point Processing Toggle
 *
 * Option to switch the audio engine between f32 and f64 processing.
 * In WebAudio all processing is f32, but this sets a preference
 * for native (Tauri/Rust) processing paths and offline render.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type BitDepthMode = 'f32' | 'f64';

export type AudioPrecisionState = {
    /** Current processing mode */
    mode: BitDepthMode;
    /** Whether the native backend supports f64 */
    nativeF64Supported: boolean;
    /** Auto-detect best mode */
    autoDetect: boolean;
};

export const audioPrecisionStore = new Store<AudioPrecisionState>(logger, {
    initialData: {
        mode: 'f32',
        nativeF64Supported: false,
        autoDetect: true,
    },
});

export function setProcessingMode(mode: BitDepthMode): void {
    const state = audioPrecisionStore.value;
    if (!state) {
        return;
    }
    audioPrecisionStore.set({ ...state, mode, autoDetect: false });
}

export function toggleAutoDetect(): void {
    const state = audioPrecisionStore.value;
    if (!state) {
        return;
    }
    const autoDetect = !state.autoDetect;
    audioPrecisionStore.set({
        ...state,
        autoDetect,
        mode: autoDetect && state.nativeF64Supported ? 'f64' : state.mode,
    });
}

export function setNativeF64Support(supported: boolean): void {
    const state = audioPrecisionStore.value;
    if (!state) {
        return;
    }
    audioPrecisionStore.set({
        ...state,
        nativeF64Supported: supported,
        mode: state.autoDetect && supported ? 'f64' : state.mode,
    });
}

export function getCurrentPrecision(): BitDepthMode {
    return audioPrecisionStore.value?.mode ?? 'f32';
}
