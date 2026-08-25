import { createOfflineYeastRuntime } from '../engine/createOfflineYeastRuntime';
import { type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorProjection } from '../models/YeastProcessorProjection';
import { type YeastProcessorInfo } from '../models/YeastState';
import { readYeastRackForTrack } from '../stores/yeastStore';

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
    // A render spans every track, and each track's Yeast device owns its own
    // rack (issue #2422), so the projection is resolved per track from that
    // track's device — never from the ACTIVE rack, which belongs to whichever
    // device the panel last showed and would push one device's notes through
    // another's processors. Explicit `processors` keep their override meaning:
    // one fixed rack for every track.
    const projectionByTrack = new Map<string, YeastProcessorProjection>();
    const resolveProjection = (trackId: string): YeastProcessorProjection => {
        const existing = projectionByTrack.get(trackId);
        if (existing) {
            return existing;
        }
        const source = processors ?? readYeastRackForTrack(trackId).processors;
        const projection = structuredClone(createYeastRuntimeProjection(source));
        projectionByTrack.set(trackId, projection);
        return projection;
    };
    return createOfflineYeastRuntime({ resolveProjection, resolveMusicalPosition, resolvePpqPosition });
}
