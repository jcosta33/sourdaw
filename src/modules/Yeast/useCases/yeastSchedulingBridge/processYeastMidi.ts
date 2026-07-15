import {
    applyYeastRuntimeProjection,
    ensureYeastRuntime,
    getYeastRuntimeError,
    getYeastRuntimeStatus,
    processYeastRuntimeBlock,
} from '../../engine/yeastRuntime';
import { createYeastProcessorProjection } from '../../models/YeastProcessorProjection';
import { yeastStore } from '../../stores/yeastStore';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

type ProcessYeastMidiInput = {
    context: BaseAudioContext;
    events: readonly MidiEvent[];
    blockStartSamples: number;
    blockEndSamples: number;
    transport: TransportInfo;
};

function publishRuntimeStatus(): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const status = getYeastRuntimeStatus();
    const error = getYeastRuntimeError();
    const nextState = { ...state, runtimeStatus: status };
    if (error) {
        nextState.runtimeError = error;
    } else {
        delete nextState.runtimeError;
    }
    if (state.runtimeStatus !== nextState.runtimeStatus || state.runtimeError !== nextState.runtimeError) {
        yeastStore.set(nextState);
    }
}

export async function processYeastMidi(input: ProcessYeastMidiInput): Promise<MidiEvent[]> {
    const state = yeastStore.value;
    if (!state) {
        return [...input.events];
    }

    const projection = createYeastProcessorProjection(state.processors);
    if (projection.length === 0) {
        return [...input.events];
    }

    try {
        await applyYeastRuntimeProjection(projection);
        const node = await ensureYeastRuntime({ context: input.context, projection });
        publishRuntimeStatus();
        if (!node) {
            return [...input.events];
        }

        const processed = await processYeastRuntimeBlock(input);
        publishRuntimeStatus();
        return processed ?? [...input.events];
    } catch {
        publishRuntimeStatus();
        return [...input.events];
    }
}
