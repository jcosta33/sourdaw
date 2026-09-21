import { trackStore } from '#/modules/Arrangement/stores';
import { grooveTemplateStore, type GrooveTemplateState } from '#/modules/MIDI/stores';

import { type YeastProcessorProjection } from '../models/YeastProcessorProjection';
import { type YeastProcessorInfo } from '../models/YeastState';
import { readYeastRack } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';

type CaptureOfflineYeastProjectionsInput = {
    tracks?: readonly { id: string; devices: readonly { id: string; type: string }[] }[];
    /** When supplied, missing device keys are empty racks rather than live fallbacks. */
    processorsByDevice?: Readonly<Record<string, readonly YeastProcessorInfo[]>>;
    grooveState?: GrooveTemplateState | null;
};

/** Resolve every track rack and its groove parameters synchronously, before scheduling starts. */
export function captureOfflineYeastProjections({
    tracks = trackStore.value?.tracks ?? [],
    processorsByDevice,
    grooveState = grooveTemplateStore.value,
}: CaptureOfflineYeastProjectionsInput = {}): Record<string, YeastProcessorProjection> {
    const projections = tracks.map((track) => {
        const device = track.devices.find((candidate) => candidate.type === 'yeast');
        let processors: readonly YeastProcessorInfo[] = [];
        if (device) {
            if (processorsByDevice === undefined) {
                processors = readYeastRack(device.id).processors;
            } else if (Object.hasOwn(processorsByDevice, device.id)) {
                processors = processorsByDevice[device.id] ?? [];
            }
        }
        return [track.id, createYeastRuntimeProjection(processors, grooveState)] as const;
    });
    return structuredClone(Object.fromEntries(projections));
}
