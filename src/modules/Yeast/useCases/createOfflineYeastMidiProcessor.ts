import { createOfflineYeastRuntime } from '../engine/createOfflineYeastRuntime';
import { type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorInfo, yeastStore } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

type MusicalPosition = Omit<TransportInfo, 'sampleRate' | 'ppqPosition' | 'isPlaying'>;
type CreateOfflineYeastMidiProcessorInput = {
    resolveMusicalPosition: (ppqPosition: number) => MusicalPosition;
    resolvePpqPosition: (input: { samples: number; sampleRate: number }) => number;
    processors?: readonly YeastProcessorInfo[];
};

export function createOfflineYeastMidiProcessor({
    resolveMusicalPosition,
    resolvePpqPosition,
    processors,
}: CreateOfflineYeastMidiProcessorInput) {
    const sourceProcessors = processors ?? yeastStore.value?.processors ?? [];
    const projection = structuredClone(createYeastRuntimeProjection(sourceProcessors));
    return createOfflineYeastRuntime({ projection, resolveMusicalPosition, resolvePpqPosition });
}
