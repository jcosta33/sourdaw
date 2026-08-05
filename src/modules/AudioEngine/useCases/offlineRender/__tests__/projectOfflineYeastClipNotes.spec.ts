import { describe, it, expect, vi, beforeEach } from 'vitest';

import { projectOfflineYeastClipNotes } from '../projectOfflineYeastClipNotes';

function makeNote(
    overrides: Partial<{ id: string; pitch: number; velocity: number; startPpq: number; endPpq: number }> = {}
) {
    return { id: 'n1', pitch: 60, velocity: 100, startPpq: 0, endPpq: 1, ...overrides };
}

function makeInput(overrides: Record<string, unknown> = {}) {
    return {
        notes: [makeNote()],
        clipId: 'c1',
        clipStartBeat: 0,
        clipEndBeat: 4,
        iterationStartBeat: 0,
        loopLengthBeats: 4,
        midiOffsetBeats: 0,
        loopEnabled: false,
        toasterPadIndex: 0,
        sampleRate: 48000,
        defaultTempo: 120,
        changes: [],
        projectMidiEvents: vi.fn((input: { events: readonly unknown[] }) =>
            input.events.map((_e, i) => ({ id: `p${i}`, pitch: 60, velocity: 100, startBeat: 0, duration: 1 }))
        ),
        projectPpqEndpoints: vi.fn(() => ({ startSamples: 0, endSamples: 48000 })),
        projectPitch: vi.fn((input: { pitch: number }) => input.pitch),
        ...overrides,
    } as never;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('projectOfflineYeastClipNotes — basic projection', () => {
    it('calls projectMidiEvents with transformed notes (startBeat offset, duration clamp)', () => {
        const projectMidiEvents = vi.fn((input: { events: readonly unknown[] }) => input.events.map((e) => e));
        projectOfflineYeastClipNotes(
            makeInput({
                notes: [makeNote({ startPpq: 2, endPpq: 5 })],
                midiOffsetBeats: 1,
                projectMidiEvents,
            })
        );
        const callArg = projectMidiEvents.mock.calls[0]?.[0] as {
            events: Array<{ startBeat: number; duration: number }>;
        };
        expect(callArg.events[0]!.startBeat).toBe(1); // startPpq(2) - midiOffset(1)
        expect(callArg.events[0]!.duration).toBe(3); // endPpq(5) - startPpq(2)
    });

    it('clamps duration to >= 0 when endPpq < startPpq', () => {
        const projectMidiEvents = vi.fn((input: { events: readonly unknown[] }) => input.events.map((e) => e));
        projectOfflineYeastClipNotes(
            makeInput({
                notes: [makeNote({ startPpq: 5, endPpq: 2 })],
                projectMidiEvents,
            })
        );
        const callArg = projectMidiEvents.mock.calls[0]?.[0] as { events: Array<{ duration: number }> };
        expect(callArg.events[0]!.duration).toBe(0); // Math.max(0, 2-5)
    });
});

describe('projectOfflineYeastClipNotes — output mapping', () => {
    it('maps projected notes with pitch, velocity, startSamples, endSamples', () => {
        const result = projectOfflineYeastClipNotes(
            makeInput({
                projectMidiEvents: () => [{ id: 'p1', pitch: 64, velocity: 80, startBeat: 1, duration: 2 }],
                projectPpqEndpoints: () => ({ startSamples: 48000, endSamples: 144000 }),
            })
        );
        expect(result).toHaveLength(1);
        expect(result[0]!.pitch).toBe(64);
        expect(result[0]!.velocity).toBe(80);
        expect(result[0]!.startSamples).toBe(48000);
        expect(result[0]!.endSamples).toBe(144000);
    });

    it('applies projectPitch with referenceBeat=clipStartBeat', () => {
        const projectPitch = vi.fn(
            (input: { pitch: number; referenceBeat: number; targetBeat: number }) => input.pitch + 12
        );
        const result = projectOfflineYeastClipNotes(
            makeInput({
                clipStartBeat: 2,
                projectMidiEvents: () => [{ id: 'p1', pitch: 60, velocity: 100, startBeat: 3, duration: 1 }],
                projectPitch,
            })
        );
        const pitchCall = projectPitch.mock.calls[0]?.[0];
        expect(pitchCall?.referenceBeat).toBe(2);
        expect(pitchCall?.targetBeat).toBe(3);
        expect(result[0]!.pitch).toBe(72);
    });

    it('computes endBeat from startBeat + duration', () => {
        const result = projectOfflineYeastClipNotes(
            makeInput({
                projectMidiEvents: () => [{ id: 'p1', pitch: 60, velocity: 100, startBeat: 1.5, duration: 2.5 }],
            })
        );
        expect(result[0]!.startBeat).toBe(1.5);
        expect(result[0]!.endBeat).toBe(4);
    });

    it('passes toasterPadIndex through to output', () => {
        const result = projectOfflineYeastClipNotes(makeInput({ toasterPadIndex: 5 }));
        expect(result[0]!.toasterPadIndex).toBe(5);
    });
});

describe('projectOfflineYeastClipNotes — empty notes', () => {
    it('returns empty array when notes is empty', () => {
        const result = projectOfflineYeastClipNotes(makeInput({ notes: [] }));
        expect(result).toEqual([]);
    });
});
