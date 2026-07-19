import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorProjection } from '../models/YeastProcessorProjection';
import { MidiRack } from '../workers/MidiRack';
import { createProcessor } from '../workers/processorFactory';

type MusicalPosition = Omit<TransportInfo, 'sampleRate' | 'ppqPosition' | 'isPlaying'>;
type CreateOfflineYeastRuntimeInput = {
    projection: YeastProcessorProjection;
    resolveMusicalPosition: (ppqPosition: number) => MusicalPosition;
};
type ProcessOfflineYeastMidiInput = {
    trackId: string;
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    events: readonly MidiEvent[];
};

export function createOfflineYeastRuntime({ projection, resolveMusicalPosition }: CreateOfflineYeastRuntimeInput) {
    const racksByTrack = new Map<string, MidiRack>();

    return (input: ProcessOfflineYeastMidiInput): MidiEvent[] => {
        if (projection.length === 0) {
            return input.events.map((event) => ({ ...event, kind: { ...event.kind } }));
        }

        let rack = racksByTrack.get(input.trackId);
        if (!rack) {
            rack = new MidiRack();
            rack.replaceProjection(projection, createProcessor);
            racksByTrack.set(input.trackId, rack);
        }

        const firstPpq = input.events.find((event) => event.timePpq !== undefined)?.timePpq ?? 0;
        const transport: TransportInfo = {
            ...resolveMusicalPosition(firstPpq),
            sampleRate: input.sampleRate,
            ppqPosition: firstPpq,
            isPlaying: false,
        };
        const preparedEvents = input.events.map((event) => {
            if (event.timePpq === undefined || event.tempoBpm !== undefined) {
                return { ...event, kind: { ...event.kind } };
            }
            return {
                ...event,
                kind: { ...event.kind },
                tempoBpm: resolveMusicalPosition(event.timePpq).bpm,
            };
        });
        const output = rack.processBlock(
            preparedEvents,
            input.blockStartSamples,
            input.blockEndSamples,
            transport,
            input.trackId
        );

        return output.map((event) => ({ ...event, kind: { ...event.kind } }));
    };
}
