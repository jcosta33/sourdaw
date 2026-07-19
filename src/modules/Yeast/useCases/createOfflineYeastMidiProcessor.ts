import { createOfflineYeastRuntime } from '../engine/createOfflineYeastRuntime';
import { type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorInfo, yeastStore } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

type MusicalPosition = Omit<TransportInfo, 'sampleRate' | 'ppqPosition' | 'isPlaying'>;
type CreateOfflineYeastMidiProcessorInput = {
    resolveMusicalPosition: (ppqPosition: number) => MusicalPosition;
    processors?: readonly YeastProcessorInfo[];
};
export function createOfflineYeastMidiProcessor({
    resolveMusicalPosition,
    processors,
}: CreateOfflineYeastMidiProcessorInput) {
    const sourceProcessors = processors ?? yeastStore.value?.processors ?? [];
    const projection = structuredClone(createYeastRuntimeProjection(sourceProcessors));
    return createOfflineYeastRuntime({ projection, resolveMusicalPosition });
}
