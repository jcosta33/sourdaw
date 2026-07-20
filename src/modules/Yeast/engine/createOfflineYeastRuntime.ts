import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { type YeastProcessorProjection } from '../models/YeastProcessorProjection';
import { MidiRack } from '../workers/MidiRack';
import { createProcessor } from '../workers/processorFactory';

type MusicalPosition = Omit<TransportInfo, 'sampleRate' | 'ppqPosition' | 'isPlaying'>;
type CreateOfflineYeastRuntimeInput = {
    projection: YeastProcessorProjection;
    resolveMusicalPosition: (ppqPosition: number) => MusicalPosition;
    resolvePpqPosition: (input: { samples: number; sampleRate: number }) => number;
};
type ProcessOfflineYeastMidiInput = {
    trackId: string;
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    events: readonly MidiEvent[];
};
type OfflineMidiEvent = MidiEvent & { timePpq: number };

export function createOfflineYeastRuntime({
    projection,
    resolveMusicalPosition,
    resolvePpqPosition,
}: CreateOfflineYeastRuntimeInput) {
    const racksByTrack = new Map<string, MidiRack>();

    return (input: ProcessOfflineYeastMidiInput): OfflineMidiEvent[] => {
        if (projection.length === 0) {
            return input.events.map((event) => ({
                ...event,
                timePpq:
                    event.timePpq ?? resolvePpqPosition({ samples: event.timeSamples, sampleRate: input.sampleRate }),
                kind: { ...event.kind },
            }));
        }

        let rack = racksByTrack.get(input.trackId);
        if (!rack) {
            rack = new MidiRack();
            rack.replaceProjection(projection, createProcessor);
            racksByTrack.set(input.trackId, rack);
        }

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
        preparedEvents.sort((alpha, beta) => alpha.timeSamples - beta.timeSamples);
        const output: OfflineMidiEvent[] = [];
        let inputIndex = 0;
        let blockStartSamples = input.blockStartSamples;
        while (blockStartSamples < input.blockEndSamples) {
            const blockEndSamples = Math.min(blockStartSamples + 128, input.blockEndSamples);
            const blockEvents: MidiEvent[] = [];
            while (inputIndex < preparedEvents.length) {
                const event = preparedEvents[inputIndex]!;
                if (event.timeSamples >= blockEndSamples) {
                    break;
                }
                blockEvents.push(event);
                inputIndex++;
            }
            const blockPpq = resolvePpqPosition({ samples: blockStartSamples, sampleRate: input.sampleRate });
            const transport: TransportInfo = {
                ...resolveMusicalPosition(blockPpq),
                sampleRate: input.sampleRate,
                ppqPosition: blockPpq,
                isPlaying: true,
            };
            const blockOutput = rack.processOfflineBlock(
                blockEvents,
                blockStartSamples,
                blockEndSamples,
                transport,
                input.trackId
            );
            for (const event of blockOutput) {
                output.push({
                    ...event,
                    timePpq:
                        event.timePpq ??
                        resolvePpqPosition({ samples: event.timeSamples, sampleRate: input.sampleRate }),
                    kind: { ...event.kind },
                });
            }
            blockStartSamples = blockEndSamples;
        }

        for (const event of rack.allNotesOff(input.blockEndSamples)) {
            output.push({
                ...event,
                timePpq: resolvePpqPosition({ samples: event.timeSamples, sampleRate: input.sampleRate }),
                kind: { ...event.kind },
            });
        }
        return output;
    };
}
