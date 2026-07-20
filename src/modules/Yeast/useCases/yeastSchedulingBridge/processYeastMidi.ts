import { yeastPreviewTap } from '../../engine/yeastPreviewTap';
import { processYeastRuntimeTransaction } from '../../engine/yeastRuntime';
import { yeastStore } from '../../stores/yeastStore';
import { createYeastRuntimeProjection } from '../createYeastRuntimeProjection';
import { publishYeastRuntimeStatus } from '../publishYeastRuntimeStatus';

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
    preserveInputTrackIds?: boolean;
};

export async function processYeastMidi(input: ProcessYeastMidiInput): Promise<MidiEvent[]> {
    const state = yeastStore.value;
    if (!state) {
        return [...input.events];
    }

    const projection = createYeastRuntimeProjection(state.processors);
    const previewScope = {
        rackId: input.rackId ?? input.trackId,
        routeId: input.routeId ?? input.trackId,
        trackId: input.trackId,
    };
    if (projection.length === 0 && !yeastPreviewTap.isEnabled(previewScope)) {
        return [...input.events];
    }
    let output: MidiEvent[];
    try {
        const processed = await processYeastRuntimeTransaction({
            ...input,
            rackId: previewScope.rackId,
            routeId: previewScope.routeId,
            projection,
        });
        publishYeastRuntimeStatus();
        output = processed ?? [...input.events];
    } catch {
        publishYeastRuntimeStatus();
        output = [...input.events];
    }

    return output;
}
