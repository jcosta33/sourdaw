import { getYeastRuntimeError, getYeastRuntimeStatus, processYeastRuntimeTransaction } from '../../engine/yeastRuntime';
import { createYeastProcessorProjection } from '../../models/YeastProcessorProjection';
import { yeastStore } from '../../stores/yeastStore';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

type ProcessYeastMidiInput = {
    context: BaseAudioContext;
    rackId?: string;
    routeId?: string;
    trackId: string;
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

    let output: MidiEvent[];
    try {
        const processed = await processYeastRuntimeTransaction({
            ...input,
            rackId: input.rackId ?? input.trackId,
            routeId: input.routeId ?? input.trackId,
            projection,
        });
        publishRuntimeStatus();
        output = processed ?? [...input.events];
    } catch {
        publishRuntimeStatus();
        output = [...input.events];
    }

    return output;
}
