import { describe, it, expect, vi } from 'vitest';

import { type OfflineMidiEventProjector } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { projectOfflineYeastTrackNotes } from '../projectOfflineYeastTrackNotes';

type ProjectableEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

function projectPpqEndpoints({ startPpq, endPpq, sampleRate }: Parameters<OfflinePpqEndpointProjector>[0]) {
    return {
        startSamples: startPpq * sampleRate,
        endSamples: endPpq * sampleRate,
        durationSamples: (endPpq - startPpq) * sampleRate,
        startSeconds: startPpq,
        endSeconds: endPpq,
        durationSeconds: endPpq - startPpq,
    };
}

describe('projectOfflineYeastTrackNotes', () => {
    it('drives generators once for all clips and loop iterations on a track', () => {
        const phases: string[] = [];
        function projectMidiEvents<Event extends ProjectableEvent>(
            input: Parameters<OfflineMidiEventProjector>[0]
        ): readonly Event[] {
            phases.push(input.phase ?? 'complete');
            return input.events as readonly Event[];
        }
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) => [
            {
                timeSamples: 100,
                timePpq: 1,
                trackId: input.trackId,
                kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 },
            },
            {
                timeSamples: 200,
                timePpq: 2,
                trackId: input.trackId,
                kind: { type: 'noteOff', channel: 0, note: 64 },
            },
        ]);
        const emptyIteration = {
            sourceNotes: [],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 2,
            midiOffsetBeats: 0,
            loopEnabled: true,
        };

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                emptyIteration,
                { ...emptyIteration, iterationStartBeat: 2 },
                { ...emptyIteration, clipId: 'clip-2' },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
        });

        expect(processYeastMidi).toHaveBeenCalledTimes(1);
        expect(phases).toEqual(['clip-groove', 'clip-groove', 'clip-groove', 'sequencer-groove']);
        expect(notes).toEqual([expect.objectContaining({ pitch: 64, startSamples: 100, endSamples: 200 })]);
    });
});
