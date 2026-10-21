import { describe, expect, it, vi } from 'vitest';

import { projectCommittedGroove } from '#/modules/MIDI/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { processLiveYeastTrackBlock } from '../processLiveYeastTrackBlock';

vi.mock('#/modules/MIDI/useCases', () => ({
    projectCommittedGroove: vi.fn(({ events }: { events: readonly unknown[] }) => events),
}));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
}));

describe('processLiveYeastTrackBlock', () => {
    it('preserves note identity when overlapping same-pitch voices release in reverse voice order', async () => {
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(processYeastMidi).mockImplementation(({ events }) => {
            const noteOns = events.filter((event) => event.kind.type === 'noteOn');
            const noteOffs = new Map(
                events
                    .filter((event) => event.kind.type === 'noteOff')
                    .map((event) => [event.noteInstanceId, event] as const)
            );
            const [firstOn, secondOn] = noteOns;
            return Promise.resolve([
                firstOn!,
                secondOn!,
                noteOffs.get(secondOn!.noteInstanceId)!,
                noteOffs.get(firstOn!.noteInstanceId)!,
            ]);
        });

        const result = await processLiveYeastTrackBlock({
            context: { sampleRate: 48_000 } as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            iterations: [
                {
                    routeId: 'route-a',
                    clipId: 'clip-a',
                    iterationStartBeat: 0,
                    iterationEndBeat: 2,
                    midiOffsetBeats: 0,
                    sourceNotes: [
                        { id: 'voice-a', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                        { id: 'voice-b', pitch: 60, startBeat: 0.25, duration: 0.5, velocity: 90 },
                    ],
                },
            ],
            fromBeat: 0,
            toBeat: 2,
            changes: [],
            timeSignatureChanges: [],
            transport: { ...defaultTransportState, tempo: 120 },
            isCurrent: () => true,
        });

        const inputEvents = vi.mocked(processYeastMidi).mock.calls[0]![0].events;
        const identities = new Set(inputEvents.map((event) => event.noteInstanceId));
        expect(identities).toEqual(new Set(['route-a:voice-a', 'route-a:voice-b']));
        for (const identity of identities) {
            const endpoints = inputEvents.filter((event) => event.noteInstanceId === identity);
            expect(endpoints).toHaveLength(2);
            expect(endpoints[0]!.sourceEventId).not.toBe(endpoints[1]!.sourceEventId);
        }
        expect(result?.notesByRoute.get('route-a')).toEqual([
            expect.objectContaining({ pitch: 60, velocity: 100, startBeat: 0, duration: 1 }),
            expect.objectContaining({ pitch: 60, velocity: 90, startBeat: 0.25, duration: 0.5 }),
        ]);
    });

    it('retains the authored duration when a note release falls beyond this scheduler block', async () => {
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(processYeastMidi).mockImplementation(({ events }) => Promise.resolve([...events]));

        const result = await processLiveYeastTrackBlock({
            context: { sampleRate: 48_000 } as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            iterations: [
                {
                    routeId: 'route-a',
                    clipId: 'clip-a',
                    iterationStartBeat: 0,
                    iterationEndBeat: 2,
                    midiOffsetBeats: 0,
                    sourceNotes: [{ id: 'long-note', pitch: 67, startBeat: 0, duration: 1.5, velocity: 96 }],
                },
            ],
            fromBeat: 0,
            toBeat: 0.5,
            changes: [],
            timeSignatureChanges: [],
            transport: { ...defaultTransportState, tempo: 120 },
            isCurrent: () => true,
        });

        expect(result?.notesByRoute.get('route-a')).toEqual([
            expect.objectContaining({ pitch: 67, startBeat: 0, duration: 1.5 }),
        ]);
        expect(vi.mocked(processYeastMidi).mock.lastCall?.[0].events).toEqual([
            expect.objectContaining({ durationSamples: 36_000, durationPpq: 1.5 }),
        ]);
    });

    it('projects a source-free generator duration without waiting for a later release block', async () => {
        vi.mocked(processYeastMidi).mockResolvedValue([
            {
                timeSamples: 0,
                durationSamples: 12_000,
                trackId: 'track-a',
                kind: { type: 'noteOn', channel: 0, note: 72, velocity: 88 },
            },
        ]);

        const result = await processLiveYeastTrackBlock({
            context: { sampleRate: 48_000 } as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            iterations: [],
            fromBeat: 0,
            toBeat: 0.5,
            changes: [],
            timeSignatureChanges: [],
            transport: { ...defaultTransportState, tempo: 120 },
            isCurrent: () => true,
        });

        expect(result?.generatedNotes).toEqual([expect.objectContaining({ pitch: 72, startBeat: 0, duration: 0.5 })]);
    });

    it('keeps a row past the anchored loop region silent while the wrapped head sounds', async () => {
        // The anchor sits 4 beats behind the trimmed head (start 4, anchor 0,
        // advance 4), so the anchored window reads [−4, 0): the head at −4
        // wraps onto the pass opening at beat 4, and the 0.5 row — which the
        // wrap alone would re-anchor into the pass at 4.5 — reads past the
        // region end on its stored figure and never reaches the rack.
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(processYeastMidi).mockImplementation(({ events }) => Promise.resolve([...events]));
        vi.mocked(processYeastMidi).mockClear();

        const result = await processLiveYeastTrackBlock({
            context: { sampleRate: 48_000 } as BaseAudioContext,
            rackId: 'rack-a',
            trackId: 'track-a',
            iterations: [
                {
                    routeId: 'route-a',
                    clipId: 'clip-a',
                    iterationStartBeat: 4,
                    iterationEndBeat: 8,
                    midiOffsetBeats: 0,
                    loopEnabled: true,
                    loopLengthBeats: 4,
                    clipStartBeat: 4,
                    loopOriginBeat: 0,
                    sourceNotes: [
                        { id: 'loop-head', pitch: 60, startBeat: -4, duration: 1, velocity: 100 },
                        { id: 'past-region', pitch: 72, startBeat: 0.5, duration: 0.25, velocity: 100 },
                    ],
                },
            ],
            fromBeat: 4,
            toBeat: 8,
            changes: [],
            timeSignatureChanges: [],
            transport: { ...defaultTransportState, tempo: 120 },
            isCurrent: () => true,
        });

        const inputEvents = vi.mocked(processYeastMidi).mock.lastCall?.[0].events ?? [];
        const voicedEvents = inputEvents.flatMap((event) =>
            event.kind.type === 'noteOn' || event.kind.type === 'noteOff'
                ? [[event.kind.note, event.timePpq, event.kind.type] as const]
                : []
        );
        expect(voicedEvents).toEqual([
            [60, 4, 'noteOn'],
            [60, 5, 'noteOff'],
        ]);
        expect(result?.notesByRoute.get('route-a')).toEqual([expect.objectContaining({ pitch: 60, startBeat: 4 })]);
    });
});
