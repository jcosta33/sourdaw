import { describe, it, expect, vi } from 'vitest';

import { defaultGrooveTemplateState, type GrooveTemplateState } from '#/modules/MIDI/stores';
import { createGrooveMidiEventProjector } from '#/modules/MIDI/useCases';
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

    it('hands the rack a note crossing the pass end as its in-pass segment and its own pass-head note', () => {
        // The live window's list for the same pass (processLiveYeastTrackBlock):
        // loop 4, pass [4, 8), the note at 3.5 released on the pass end and
        // its last half beat struck on the pass head as a distinct instance
        // that plays the source row, half a beat into it.
        const expression = { pressure: [{ offsetBeats: 0.25, value: 90 }] };
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples / 100 }))
        );

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                {
                    sourceNotes: [
                        { id: 'crossing', pitch: 60, startBeat: 3.5, duration: 1, velocity: 100, expression },
                    ],
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: 16,
                    iterationStartBeat: 4,
                    loopLengthBeats: 4,
                    midiOffsetBeats: 0,
                    loopEnabled: true,
                },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 1_600,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: (input) => input.events,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        const route = 'offline-yeast:track-1:0';
        expect(
            processYeastMidi.mock.calls[0]![0].events.map((event) => [
                event.kind.type,
                event.timePpq,
                event.noteInstanceId,
            ])
        ).toEqual([
            ['noteOn', 7.5, `${route}:crossing`],
            ['noteOff', 8, `${route}:crossing`],
            ['noteOn', 4, `${route}:crossing:pass-head`],
            ['noteOff', 4.5, `${route}:crossing:pass-head`],
        ]);
        expect(notes).toEqual([
            expect.objectContaining({ pitch: 60, startBeat: 7.5, endBeat: 8, expression }),
            expect.objectContaining({ pitch: 60, startBeat: 4, endBeat: 4.5, beatsIntoNote: 0.5, expression }),
        ]);
        expect(notes[0]?.beatsIntoNote).toBeUndefined();
    });

    it('ends at the pass end the length a rack adds past it, as the live window must', () => {
        // A rack that lengthens the 0.25-beat note at 3.5 fourfold returns a
        // note running to 4.5, past the pass end. Live playback cannot strike
        // that added length on the head of a pass it has already played, so
        // the bounce, through the real projection, ends it at the pass end too.
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => {
                const timePpq = event.timePpq ?? event.timeSamples / 100;
                if (event.kind.type !== 'noteOff') {
                    return { ...event, timePpq };
                }
                return { ...event, timePpq: timePpq + 0.75, timeSamples: event.timeSamples + 75 };
            })
        );

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [0, 4].map((iterationStartBeat) => ({
                sourceNotes: [{ id: 'lengthened', pitch: 60, startBeat: 3.5, duration: 0.25, velocity: 100 }],
                clipId: 'clip-1',
                clipStartBeat: 0,
                clipEndBeat: 8,
                iterationStartBeat,
                loopLengthBeats: 4,
                midiOffsetBeats: 0,
                loopEnabled: true,
            })),
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 800,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: createGrooveMidiEventProjector(defaultGrooveTemplateState),
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        expect(notes.map((note) => [note.startBeat, note.endBeat])).toEqual([
            [3.5, 4],
            [7.5, 8],
        ]);
    });

    it('hands the rack an in-pass segment the project groove pushes past the pass end from the pass head, grooved once', () => {
        // Slot 0 of a 1/8 groove pushes 0.25 beats later and scales velocity
        // by 1.5. The note at 3.9 crosses the pass end at 4: its tail is
        // struck on the head at 0 (slot 0), and its in-pass segment, also on
        // slot 0, is pushed to 4.15, past the pass end, onto the head at 0.15.
        // The rack is handed that push where it lands, already grooved; the
        // groove after the rack moves only the tail. A second application
        // would land the push at 0.4 and clamp its velocity to 127.
        const pushGroove: GrooveTemplateState = {
            templates: [
                {
                    id: 'push',
                    name: 'Push',
                    schemaVersion: 1,
                    subdivision: '1/8',
                    slots: [{ index: 0, timingOffset: 0.5, dynamicsOffset: 0.5 }],
                    provenance: { type: 'user', sourceId: 'spec' },
                },
            ],
            assignments: [{ consumerType: 'sequencer', consumerId: 'project', templateId: 'push', amount: 1 }],
        };
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples / 100 }))
        );

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                {
                    sourceNotes: [{ id: 'crossing', pitch: 60, startBeat: 3.9, duration: 0.5, velocity: 60 }],
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: 4,
                    iterationStartBeat: 0,
                    loopLengthBeats: 4,
                    midiOffsetBeats: 0,
                    loopEnabled: true,
                },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: createGrooveMidiEventProjector(pushGroove),
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        const route = 'offline-yeast:track-1:0';
        expect(
            processYeastMidi.mock.calls[0]![0].events.map((event) => [
                event.kind.type,
                event.timePpq,
                event.noteInstanceId,
                event.kind.type === 'noteOn' ? event.kind.velocity : undefined,
            ])
        ).toEqual([
            ['noteOn', expect.closeTo(0.15, 9), `${route}:crossing:pass-groove`, 90],
            ['noteOff', expect.closeTo(0.25, 9), `${route}:crossing:pass-groove`, undefined],
            ['noteOn', 0, `${route}:crossing:pass-head`, 60],
            ['noteOff', expect.closeTo(0.4, 9), `${route}:crossing:pass-head`, undefined],
        ]);
        expect(notes.map((note) => [note.startBeat, note.endBeat, note.velocity])).toEqual([
            [expect.closeTo(0.15, 9), expect.closeTo(0.25, 9), 90],
            [0.25, expect.closeTo(0.65, 9), 90],
        ]);
    });

    it('hands the rack a segment the project groove pulls back across the pass head where the loop places it, tail on the head', () => {
        // Slot 0 of a 1/8 groove pulls 0.25 beats earlier. The note at 1/32
        // is pulled to −0.21875, before the pass head: the loop places it at
        // 3.78125, ending at the pass end, and the 0.28125 beats that ring
        // past it are struck on the head at 0. The rack is handed both where
        // they sound, already grooved, so the window holding the head owns
        // that tail instead of a later window posting it behind itself.
        const pullGroove: GrooveTemplateState = {
            templates: [
                {
                    id: 'pull',
                    name: 'Pull',
                    schemaVersion: 1,
                    subdivision: '1/8',
                    slots: [{ index: 0, timingOffset: -0.5, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'spec' },
                },
            ],
            assignments: [{ consumerType: 'sequencer', consumerId: 'project', templateId: 'pull', amount: 1 }],
        };
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples / 100 }))
        );

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [
                {
                    sourceNotes: [{ id: 'pulled', pitch: 60, startBeat: 1 / 32, duration: 0.5, velocity: 80 }],
                    clipId: 'clip-1',
                    clipStartBeat: 0,
                    clipEndBeat: 4,
                    iterationStartBeat: 0,
                    loopLengthBeats: 4,
                    midiOffsetBeats: 0,
                    loopEnabled: true,
                },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: createGrooveMidiEventProjector(pullGroove),
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        const route = 'offline-yeast:track-1:0';
        expect(
            processYeastMidi.mock.calls[0]![0].events.map((event) => [
                event.kind.type,
                event.timePpq,
                event.noteInstanceId,
            ])
        ).toEqual([
            ['noteOn', expect.closeTo(3.78125, 9), `${route}:pulled:pass-groove`],
            ['noteOff', 4, `${route}:pulled:pass-groove`],
            ['noteOn', 0, `${route}:pulled:pass-groove:pass-head`],
            ['noteOff', expect.closeTo(0.28125, 9), `${route}:pulled:pass-groove:pass-head`],
        ]);
        expect(notes.map((note) => [note.startBeat, note.endBeat])).toEqual([
            [expect.closeTo(3.78125, 9), 4],
            [0, expect.closeTo(0.28125, 9)],
        ]);
    });

    it('sounds nothing of a note the rack itself moves past the pass end, as the live window cannot', () => {
        // A rack that delays every event by 0.15 beats moves the in-pass note
        // at 3.9 to 4.05, past the pass end. Its pass head has been played by
        // the time a live window gets the rack's output, so the bounce does
        // not fold it back onto the head either.
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({
                ...event,
                timePpq: (event.timePpq ?? 0) + 0.15,
                timeSamples: event.timeSamples + 15,
            }))
        );

        const notes = projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: [0, 4].map((iterationStartBeat) => ({
                sourceNotes: [{ id: 'delayed', pitch: 60, startBeat: 3.9, duration: 0.1, velocity: 100 }],
                clipId: 'clip-1',
                clipStartBeat: 0,
                clipEndBeat: 8,
                iterationStartBeat,
                loopLengthBeats: 4,
                midiOffsetBeats: 0,
                loopEnabled: true,
            })),
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 800,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents: createGrooveMidiEventProjector(defaultGrooveTemplateState),
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });

        expect(notes).toEqual([]);
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

describe('projectOfflineYeastTrackNotes — the anchored loop window on routed rows (#5198)', () => {
    /**
     * A clip trimmed across its anchor — start 2, anchor 4, loop 4 — so the
     * anchored window reads [2, 6) in stored-figure coordinates: the row at
     * relative 3 is in-region material and the row at relative 6.5 sits past
     * the region end, a loop's phase 2.5 into each pass only because the pass
     * re-anchors a start past its end. The anchored clip's passes open on the
     * anchor's seams; the two that reach the in-region row are 4 and 8 (the
     * seam-0 pass places it at 1, before the clip head, which cuts it). The
     * unanchored control's passes open on its own head, 2 and 6.
     */
    function projectTrimmedClipRows(loopOriginBeat: number | undefined, passStartBeats: readonly number[]) {
        function projectMidiEvents<Event extends ProjectableEvent>(
            input: Parameters<OfflineMidiEventProjector>[0]
        ): readonly Event[] {
            return input.events as readonly Event[];
        }
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples / 100 }))
        );
        return projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: passStartBeats.map((iterationStartBeat) => ({
                sourceNotes: [
                    { id: 'in-window', pitch: 61, startBeat: 3, duration: 0.25, velocity: 100 },
                    { id: 'past-region', pitch: 72, startBeat: 6.5, duration: 0.25, velocity: 100 },
                ],
                clipId: 'clip-1',
                clipStartBeat: 2,
                clipEndBeat: 10,
                iterationStartBeat,
                loopLengthBeats: 4,
                midiOffsetBeats: 0,
                loopEnabled: true,
                loopOriginBeat,
            })),
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400_000,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });
    }

    it('keeps the row past the trimmed region end out of the rack input and the rendered pass', () => {
        // The membership runs on the row's stored figure before the
        // clip-groove phase offers it to the rack: the 6.5 row reads past the
        // [2, 6) window in both passes and never renders; the 3 row sounds at
        // its pass positions 5 and 9.
        const notes = projectTrimmedClipRows(4, [4, 8]);

        expect(notes.map((note) => [note.pitch, note.startBeat])).toEqual([
            [61, 5],
            [61, 9],
        ]);
    });

    it('keeps a row stored at or past the loop length silent when the clip carries no anchor', () => {
        // An anchorless loop plays [0, loopLength) of its stored rows, as the
        // synth route's window does: the 6.5 row reads past it and sounds on
        // no pass, though the pass mapping would re-anchor it to 4.5 and 8.5.
        const notes = projectTrimmedClipRows(undefined, [2, 6]);

        expect(notes.map((note) => [note.pitch, note.startBeat])).toEqual([
            [61, 5],
            [61, 9],
        ]);
    });

    /**
     * The review probe (#5198): a boundary row the clip groove displaces
     * across the ceiling. Clip start 2, anchor 0, loop 4, offset 2 — window
     * [−2, 2); the row stored at 3.9 reads source relative 1.9, admitted by
     * every gate, and the committed clip groove (applied pre-rack by the
     * `clip-groove` phase) routes it to absolute 6.15 — a routed figure of
     * 2.15, past the ceiling. Membership on the routed figure dropped it
     * here while the live twin voiced it; membership on the source figure
     * keeps one clip rendering as one clip.
     */
    function projectGrooveDisplacedBoundaryRow(
        loopOriginBeat: number | undefined,
        iterationStartBeats: readonly number[]
    ) {
        function projectMidiEvents<Event extends ProjectableEvent>(
            input: Parameters<OfflineMidiEventProjector>[0]
        ): readonly Event[] {
            const events = input.events as readonly Event[];
            // The committed clip groove, as the real projector applies it in
            // the `clip-groove` phase: every start a quarter beat late.
            return input.phase === 'clip-groove'
                ? events.map((event) => ({ ...event, startBeat: event.startBeat + 0.25 }))
                : events;
        }
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>((input) =>
            input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples / 100 }))
        );
        return projectOfflineYeastTrackNotes({
            trackId: 'track-1',
            iterations: iterationStartBeats.map((iterationStartBeat) => ({
                sourceNotes: [{ id: 'boundary', pitch: 61, startBeat: 3.9, duration: 0.25, velocity: 100 }],
                clipId: 'clip-1',
                clipStartBeat: 2,
                clipEndBeat: 10,
                iterationStartBeat,
                loopLengthBeats: 4,
                midiOffsetBeats: 2,
                loopEnabled: true,
                loopOriginBeat,
            })),
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 400_000,
            defaultTempo: 60,
            changes: [],
            projectMidiEvents,
            projectPpqEndpoints,
            processYeastMidi,
            projectPitch: ({ pitch }) => pitch,
        });
    }

    it('voices a groove-displaced boundary row whose routed figure sits past the ceiling', () => {
        // On the anchor's grid the row sits 3.9 into each pass (its relative
        // 1.9 plus the advance 2), and the groove's quarter beat routes it
        // 4.15 in, past the pass end, so each pass re-anchors it to 0.15 in:
        // the seam-0 pass places it before the clip head, which cuts it, and
        // the seam-4 pass sounds it at 4.15, as the live window does.
        const notes = projectGrooveDisplacedBoundaryRow(0, [0, 4]);

        expect(notes.map((note) => [note.pitch, note.startBeat])).toEqual([[61, 4.15]]);
    });

    it('control: voices the same displaced row when the clip carries no anchor', () => {
        // The clip-head pass at 2 places it unwrapped: 2 + 3.9 + 0.25 − 2 = 4.15.
        const notes = projectGrooveDisplacedBoundaryRow(undefined, [2]);

        expect(notes.map((note) => [note.pitch, note.startBeat])).toEqual([[61, 4.15]]);
    });
});
