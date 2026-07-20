import { describe, it, expect, vi } from 'vitest';

import { projectOfflineYeastNotes } from '../projectOfflineYeastNotes';

import type { OfflineYeastMidiProcessor } from '../../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

describe('projectOfflineYeastNotes', () => {
    it('pairs the runtime terminal release used to clamp an active voice at the render boundary', () => {
        const processYeastMidi = vi.fn(() => [
            {
                timeSamples: 100,
                timePpq: 1,
                trackId: 'track-1',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 200,
                timePpq: 2,
                trackId: 'track-1',
                kind: { type: 'noteOff' as const, channel: 0, note: 60 },
            },
        ]);

        const projected = projectOfflineYeastNotes({
            trackId: 'track-1',
            notes: [{ id: 'source', pitch: 60, startBeat: 1, duration: 4, velocity: 100 }],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 200,
            projectPpqEndpoints: ({ startPpq, endPpq }) => ({
                startSamples: startPpq * 100,
                endSamples: endPpq * 100,
            }),
            processYeastMidi,
        });

        expect(projected).toEqual([
            {
                id: 'yeast:track-1:0',
                pitch: 60,
                velocity: 100,
                startSamples: 100,
                startPpq: 1,
                endSamples: 200,
                endPpq: 2,
                routeId: 'track-1',
            },
        ]);
    });

    it('pairs a terminal note-off exactly at the exclusive render endpoint', () => {
        const processYeastMidi = vi.fn(() => [
            {
                timeSamples: 100,
                timePpq: 1,
                trackId: 'track-1',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 200,
                timePpq: 2,
                trackId: 'track-1',
                kind: { type: 'noteOff' as const, channel: 0, note: 60 },
            },
        ]);

        const projected = projectOfflineYeastNotes({
            trackId: 'track-1',
            notes: [],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 200,
            projectPpqEndpoints: () => ({ startSamples: 0, endSamples: 0 }),
            processYeastMidi,
        });

        expect(projected[0]).toMatchObject({
            startSamples: 100,
            endSamples: 200,
            startPpq: 1,
            endPpq: 2,
        });
    });

    it('pairs overlapping pitches independently for each clip route', () => {
        const processYeastMidi = vi.fn(() => [
            {
                timeSamples: 10,
                timePpq: 0.1,
                trackId: 'route-a',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
            {
                timeSamples: 20,
                timePpq: 0.2,
                trackId: 'route-b',
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 90 },
            },
            {
                timeSamples: 30,
                timePpq: 0.3,
                trackId: 'route-b',
                kind: { type: 'noteOff' as const, channel: 0, note: 60 },
            },
            {
                timeSamples: 40,
                timePpq: 0.4,
                trackId: 'route-a',
                kind: { type: 'noteOff' as const, channel: 0, note: 60 },
            },
        ]);

        const projected = projectOfflineYeastNotes({
            trackId: 'track-1',
            notes: [],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 100,
            projectPpqEndpoints: () => ({ startSamples: 0, endSamples: 0 }),
            processYeastMidi,
        });

        expect(projected).toEqual([
            expect.objectContaining({ routeId: 'route-b', startSamples: 20, endSamples: 30 }),
            expect.objectContaining({ routeId: 'route-a', startSamples: 10, endSamples: 40 }),
        ]);
    });

    it('pairs overlapping notes on one route by note instance when releases arrive in reverse voice order', () => {
        const processYeastMidi = vi.fn<OfflineYeastMidiProcessor>(({ events }) => {
            const [firstOn, firstOff, secondOn, secondOff] = events.map((event) => ({
                ...event,
                timePpq: event.timePpq ?? 0,
            }));
            return [firstOn!, secondOn!, secondOff!, firstOff!];
        });

        const projected = projectOfflineYeastNotes({
            trackId: 'track-1',
            notes: [
                { id: 'voice-a', pitch: 60, startBeat: 0.1, duration: 0.3, velocity: 100 },
                { id: 'voice-b', pitch: 60, startBeat: 0.2, duration: 0.1, velocity: 90 },
            ],
            sampleRate: 100,
            blockStartSamples: 0,
            blockEndSamples: 100,
            projectPpqEndpoints: ({ startPpq, endPpq }) => ({
                startSamples: startPpq * 100,
                endSamples: endPpq * 100,
            }),
            processYeastMidi,
        });

        const inputEvents = processYeastMidi.mock.calls[0]![0].events;
        expect(inputEvents[0]!.noteInstanceId).toBe(inputEvents[1]!.noteInstanceId);
        expect(inputEvents[2]!.noteInstanceId).toBe(inputEvents[3]!.noteInstanceId);
        expect(inputEvents[0]!.noteInstanceId).not.toBe(inputEvents[2]!.noteInstanceId);
        expect(inputEvents[0]!.sourceEventId).not.toBe(inputEvents[1]!.sourceEventId);
        expect(projected).toEqual([
            expect.objectContaining({ startSamples: 20, startPpq: 0.2 }),
            expect.objectContaining({ startSamples: 10, endSamples: 40, startPpq: 0.1, endPpq: 0.4 }),
        ]);
        expect(projected[0]!.endSamples).toBeCloseTo(30, 12);
        expect(projected[0]!.endPpq).toBeCloseTo(0.3, 12);
    });
});
