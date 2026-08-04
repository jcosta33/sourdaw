import { describe, it, expect, beforeEach, vi } from 'vitest';

import { beatToSamples } from '../../models/TempoMap';
import { defaultTransportState, type TransportState } from '../../models/TransportState';
import { setTempo } from '../setTempo';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type TempoMapFixture = { changes: TempoChangeFixture[] };

const { transportRef, tempoMapRef } = vi.hoisted(() => {
    const transportRef: { value: TransportState | null } = { value: null };
    const tempoMapRef: { value: TempoMapFixture | null } = { value: null };
    return { transportRef, tempoMapRef };
});

vi.mock('../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportRef.value;
        },
        set: (next: TransportState) => {
            transportRef.value = next;
        },
    },
}));

vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
        set: (next: TempoMapFixture) => {
            tempoMapRef.value = next;
        },
    },
}));

const SAMPLE_RATE = 48_000;
const NOTE_BEAT = 4;

/**
 * Mirrors what the scheduler actually does for a note at `NOTE_BEAT`:
 * `beatToSamples(changes, beat, transport.tempo, sampleRate)`
 * (scheduleMidiNotes.ts, processLiveYeastTrackBlock.ts).
 */
function scheduledNoteSamples(): number {
    return beatToSamples(tempoMapRef.value?.changes ?? [], NOTE_BEAT, transportRef.value!.tempo, SAMPLE_RATE);
}

function governingChangeTempos(): number[] {
    return (tempoMapRef.value?.changes ?? []).map((change) => change.tempo);
}

describe('setTempo with a tempo map present', () => {
    beforeEach(() => {
        transportRef.value = { ...defaultTransportState, tempo: 90, playheadPosition: 0 };
        tempoMapRef.value = { changes: [{ id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' }] };
    });

    it('moves the scheduled note position when a tempo change sits at beat 0', () => {
        // 4 beats at 90 BPM = 4 * 60 / 90 s = 2.6667 s -> 128_000 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(128_000);

        setTempo(120);

        // 4 beats at 120 BPM = 2 s -> 96_000 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(96_000);
    });

    it('rewrites the tempo event governing the playhead, not the transport base tempo', () => {
        setTempo(120);

        expect(governingChangeTempos()).toEqual([120]);
        expect(transportRef.value!.tempo).toBe(90);
    });

    it('rewrites only the change governing the playhead when several changes exist', () => {
        transportRef.value = { ...defaultTransportState, tempo: 90, playheadPosition: 8 };
        tempoMapRef.value = {
            changes: [
                { id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' },
                { id: 'tc-4', beat: 4, tempo: 100, curve: 'instant' },
                { id: 'tc-16', beat: 16, tempo: 140, curve: 'instant' },
            ],
        };

        setTempo(150);

        expect(governingChangeTempos()).toEqual([90, 150, 140]);
    });

    it('rewrites the first change when the playhead sits before every tempo change', () => {
        transportRef.value = { ...defaultTransportState, tempo: 90, playheadPosition: 0 };
        tempoMapRef.value = { changes: [{ id: 'tc-16', beat: 16, tempo: 100, curve: 'instant' }] };

        // With any non-empty map the resolver falls back to changes[0], never to
        // transport.tempo — so the first change is what the playhead hears.
        expect(scheduledNoteSamples()).toBe(115_200);

        setTempo(120);

        expect(governingChangeTempos()).toEqual([120]);
        expect(scheduledNoteSamples()).toBe(96_000);
    });

    it('still rejects out-of-range tempi and leaves the tempo map untouched', () => {
        expect(() => setTempo(10)).toThrow();
        expect(() => setTempo(400)).toThrow();

        expect(governingChangeTempos()).toEqual([90]);
        expect(transportRef.value!.tempo).toBe(90);
    });

    it('writes the transport base tempo when the tempo map is empty', () => {
        tempoMapRef.value = { changes: [] };

        setTempo(140);

        expect(transportRef.value!.tempo).toBe(140);
        // 4 beats at 140 BPM = 4 * 60 / 140 s -> 82_286 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(82_286);
    });
});
