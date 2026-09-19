import { createOfflineYeastRuntime } from '../engine/createOfflineYeastRuntime';
import { type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorProjection } from '../models/YeastProcessorProjection';
import { type YeastProcessorInfo } from '../models/YeastState';

import { captureOfflineYeastProjections } from './captureOfflineYeastProjections';
import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

type MusicalPosition = Omit<TransportInfo, 'sampleRate' | 'ppqPosition' | 'isPlaying'>;
type CreateOfflineYeastMidiProcessorInput = {
    resolveMusicalPosition: (ppqPosition: number) => MusicalPosition;
    resolvePpqPosition: (input: { samples: number; sampleRate: number }) => number;
    processors?: readonly YeastProcessorInfo[];
    tracks?: NonNullable<Parameters<typeof captureOfflineYeastProjections>[0]>['tracks'];
    processorsByDevice?: NonNullable<Parameters<typeof captureOfflineYeastProjections>[0]>['processorsByDevice'];
    grooveState?: Parameters<typeof createYeastRuntimeProjection>[1];
    projectionsByTrack?: Readonly<Record<string, YeastProcessorProjection>>;
};

export function createOfflineYeastMidiProcessor({
    resolveMusicalPosition,
    resolvePpqPosition,
    processors,
    tracks,
    processorsByDevice,
    grooveState,
    projectionsByTrack,
}: CreateOfflineYeastMidiProcessorInput) {
    // Capture before the first scheduling call: worklet setup may yield while
    // another project replaces tracks and racks under the same identities.
    const fixedProjection =
        processors === undefined ? undefined : structuredClone(createYeastRuntimeProjection(processors, grooveState));
    let captured: Readonly<Record<string, YeastProcessorProjection>> = {};
    if (fixedProjection === undefined) {
        if (projectionsByTrack === undefined) {
            captured = captureOfflineYeastProjections({ tracks, processorsByDevice, grooveState });
        } else {
            captured = structuredClone(projectionsByTrack);
        }
    }
    const projectionByTrack = new Map<string, YeastProcessorProjection>(Object.entries(captured));
    const emptyProjection: YeastProcessorProjection = [];
    const resolveProjection = (trackId: string): YeastProcessorProjection =>
        fixedProjection ?? projectionByTrack.get(trackId) ?? emptyProjection;
    return createOfflineYeastRuntime({ resolveProjection, resolveMusicalPosition, resolvePpqPosition });
}
