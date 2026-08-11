import { describe, it, expect, vi } from 'vitest';

import { createOfflineYeastMidiProcessor } from '#/modules/Yeast/useCases';

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
            projectPitch: ({ pitch }) => pitch,
        });

        expect(processYeastMidi).toHaveBeenCalledTimes(1);
        expect(phases).toEqual(['clip-groove', 'clip-groove', 'clip-groove', 'sequencer-groove']);
        expect(notes).toEqual([expect.objectContaining({ pitch: 64, startSamples: 100, endSamples: 200 })]);
    });

    it('retains each clip route through the production rack for post-Yeast projection', () => {
        function projectMidiEvents<Event extends ProjectableEvent>(
            input: Parameters<OfflineMidiEventProjector>[0]
        ): readonly Event[] {
            return input.events as readonly Event[];
        }
        const processYeastMidi = createOfflineYeastMidiProcessor({
            resolvePpqPosition: ({ samples, sampleRate }) => samples / sampleRate,
            resolveMusicalPosition: () => ({
                bpm: 60,
                barIndex: 0,
                beatInBar: 0,
                timeSigNum: 4,
                timeSigDen: 4,
                loopEnabled: false,
                loopStartPpq: 0,
                loopEndPpq: 0,
            }),
            processors: [
                {
                    id: 'transpose',
                    type: 'transposer',
                    name: 'Transposer',
                    bypassed: false,
                    params: { semitones: 12 },
                },
            ],
        });
        const sourceNotes = [{ id: 'note', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 100 }];

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                {
                    sourceNotes,
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: 2,
                    iterationStartBeat: 0,
                    loopLengthBeats: 2,
                    midiOffsetBeats: 0,
                    loopEnabled: false,
                    toasterPadIndex: 2,
                },
                {
                    sourceNotes,
                    clipId: 'clip-2',
                    clipStartBeat: 2,
                    clipEndBeat: 4,
                    iterationStartBeat: 2,
                    loopLengthBeats: 2,
                    midiOffsetBeats: 0,
                    loopEnabled: false,
                    toasterPadIndex: 3,
                },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        expect(notes).toEqual([
            expect.objectContaining({ pitch: 72, startSamples: 50, endSamples: 100, toasterPadIndex: 2 }),
            expect.objectContaining({ pitch: 72, startSamples: 250, endSamples: 300, toasterPadIndex: 3 }),
        ]);
    });

    it('inherits source expression when routed Yeast notes use generated identities', () => {
        const sourceNote = {
            id: 'source-note',
            pitch: 60,
            startBeat: 0.5,
            duration: 0.5,
            velocity: 100,
            pressure: 91,
            slide: 37,
            pitchBend: 2048,
            pitchBendRangeSemitones: 12,
        };
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>(() => [
            {
                timeSamples: 50,
                timePpq: 0.5,
                trackId: 'offline-yeast:track-1:0',
                noteInstanceId: 'generated-chord-note',
                kind: { type: 'noteOn', channel: 0, note: 67, velocity: 90 },
            },
            {
                timeSamples: 100,
                timePpq: 1,
                trackId: 'offline-yeast:track-1:0',
                noteInstanceId: 'generated-chord-note',
                kind: { type: 'noteOff', channel: 0, note: 67 },
            },
        ]);

        const [note] = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                {
                    sourceNotes: [sourceNote],
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: 2,
                    iterationStartBeat: 0,
                    loopLengthBeats: 2,
                    midiOffsetBeats: 0,
                    loopEnabled: false,
                },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 200,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: (input) => input.events,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        expect(note).toEqual(
            expect.objectContaining({ pressure: 91, slide: 37, pitchBend: 2048, pitchBendRangeSemitones: 12 })
        );
    });

    it('anchors source-free generator notes to the active carrier clip chord', () => {
        const projectPitch = vi.fn(
            ({ pitch }: { pitch: number; referenceBeat: number; targetBeat: number }) => pitch + 1
        );
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>(() => [
            {
                timeSamples: 175,
                timePpq: 1.75,
                trackId: 'track-1',
                kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 },
            },
            {
                timeSamples: 375,
                timePpq: 3.75,
                trackId: 'track-1',
                kind: { type: 'noteOff', channel: 0, note: 64 },
            },
        ]);
        const firstIteration = {
            sourceNotes: [],
            clipId: 'clip-1',
            clipStartBeat: 0,
            clipEndBeat: 2,
            iterationStartBeat: 0,
            loopLengthBeats: 2,
            midiOffsetBeats: 0,
            loopEnabled: false,
        };

        const secondIteration = {
            ...firstIteration,
            clipId: 'clip-2',
            clipStartBeat: 2.5,
            clipEndBeat: 4,
            iterationStartBeat: 2.5,
            toasterPadIndex: 7,
        };
        function projectMidiEvents<Event extends ProjectableEvent>(
            input: Parameters<OfflineMidiEventProjector>[0]
        ): readonly Event[] {
            const events = input.events as readonly Event[];
            return input.phase === 'sequencer-groove'
                ? events.map((event) => ({ ...event, startBeat: event.startBeat + 1 }))
                : events;
        }
        const input = {
            trackId: 'track-1',
            iterations: [firstIteration, secondIteration],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch,
        };
        const notes = projectOfflineYeastTrackNotes(input);

        expect(notes).toEqual([
            expect.objectContaining({ pitch: 65, startSamples: 275, endSamples: 400, toasterPadIndex: 7 }),
        ]);
        expect(projectPitch).toHaveBeenCalledWith({ pitch: 64, referenceBeat: 2.5, targetBeat: 2.75 });
        expect(projectOfflineYeastTrackNotes({ ...input, iterations: [secondIteration] })).toEqual([]);
        expect(
            projectOfflineYeastTrackNotes({
                ...input,
                iterations: [firstIteration, secondIteration, { ...secondIteration, clipId: 'clip-2-copy' }],
            })[0]?.toasterPadIndex
        ).toBe(7);
        expect(
            projectOfflineYeastTrackNotes({
                ...input,
                iterations: [firstIteration, secondIteration, { ...secondIteration, toasterPadIndex: 8 }],
            })[0]?.toasterPadIndex
        ).toBe(-1);
    });
});
