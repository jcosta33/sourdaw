import { yeastPreviewTap } from '../../engine/yeastPreviewTap';
import { processYeastRuntimeTransaction } from '../../engine/yeastRuntime';
import { readYeastRack, yeastStore } from '../../stores/yeastStore';
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
    // Racks are per device instance (issue #2422): a caller that names its
    // rack processes that device's rack; one that does not keeps the legacy
    // behaviour of processing the active rack.
    const state = input.rackId !== undefined ? readYeastRack(input.rackId) : yeastStore.value;
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
        publishYeastRuntimeStatus(input.rackId);
        output = processed ?? [...input.events];
    } catch {
        publishYeastRuntimeStatus(input.rackId);
        output = [...input.events];
    }

    return output;
}
