import { describe, it, expect, beforeEach, vi } from 'vitest';

import { beatToSamples } from '../../models/TempoMap';
import { defaultTransportState, type TransportState } from '../../models/TransportState';
import { setTempo } from '../setTempo';

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };
type TempoMapFixture = { changes: TempoChangeFixture[] };

const { transportRef, tempoMapRef, livePlayheadRef } = vi.hoisted(() => {
    const transportRef: { value: TransportState | null } = { value: null };
    const tempoMapRef: { value: TempoMapFixture | null } = { value: null };
    const livePlayheadRef = { current: 0 };
    return { transportRef, tempoMapRef, livePlayheadRef };
});

vi.mock('../../stores/transportStore', () => ({
    MIN_TEMPO: 20,
    MAX_TEMPO: 300,
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
    MIN_TEMPO_MAP_TEMPO: 20,
    MAX_TEMPO_MAP_TEMPO: 999,
    tempoMapStore: {
        get value() {
            return tempoMapRef.value;
        },
        set: (next: TempoMapFixture) => {
            tempoMapRef.value = next;
        },
    },
}));

vi.mock('../../stores/playheadPositionRef', () => ({
    playheadPositionRef: livePlayheadRef,
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
        livePlayheadRef.current = 0;
    });

    it('moves the scheduled note position when a tempo change sits at beat 0', () => {
        // 4 beats at 90 BPM = 4 * 60 / 90 s -> 128_000 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(128_000);

        setTempo({ bpm: 120 });

        // 4 beats at 120 BPM = 2 s -> 96_000 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(96_000);
    });

    it('rewrites the tempo event governing the playhead, not the transport base tempo', () => {
        setTempo({ bpm: 120 });

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

        setTempo({ bpm: 150 });

        expect(governingChangeTempos()).toEqual([90, 150, 140]);
    });

    it('rewrites the first change when the playhead sits before every tempo change', () => {
        transportRef.value = { ...defaultTransportState, tempo: 90, playheadPosition: 0 };
        tempoMapRef.value = { changes: [{ id: 'tc-16', beat: 16, tempo: 100, curve: 'instant' }] };

        // With any non-empty map the resolver falls back to changes[0], never to
        // transport.tempo — so the first change is what the playhead hears.
        expect(scheduledNoteSamples()).toBe(115_200);

        setTempo({ bpm: 120 });

        expect(governingChangeTempos()).toEqual([120]);
        expect(scheduledNoteSamples()).toBe(96_000);
    });

    it('accepts the tempo-map range, not the base-tempo range, when a map governs', () => {
        // A tempo-map change legally holds up to 999 BPM. Rejecting 400 here
        // because the transport's own field stops at 300 would leave a stored
        // 400 BPM change unrestorable by its own inverse.
        setTempo({ bpm: 400 });
        expect(governingChangeTempos()).toEqual([400]);

        expect(() => setTempo({ bpm: 1000 })).toThrow();
        expect(() => setTempo({ bpm: 10 })).toThrow();
        expect(governingChangeTempos()).toEqual([400]);
    });

    it('writes the transport base tempo when the tempo map is empty', () => {
        tempoMapRef.value = { changes: [] };

        setTempo({ bpm: 140 });

        expect(transportRef.value!.tempo).toBe(140);
        // 4 beats at 140 BPM = 4 * 60 / 140 s -> 82_286 samples @ 48 kHz.
        expect(scheduledNoteSamples()).toBe(82_286);
    });

    describe('inside a tempo ramp', () => {
        beforeEach(() => {
            transportRef.value = { ...defaultTransportState, tempo: 120, playheadPosition: 4 };
            tempoMapRef.value = {
                changes: [
                    { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
                    { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
                ],
            };
            livePlayheadRef.current = 4;
        });

        it('refuses the write instead of editing the ramp start point, and says so', () => {
            // The tempo in force at beat 4 is 110, which is neither event's own
            // value. Assigning 111 to tc-a would silently move the readout to
            // 120.5 — the control would never converge on what was typed.
            //
            // Returning `no-write` made `executeAppAction` abort the transaction
            // and return normally, so an AI caller reported the action as
            // dispatched while nothing changed. The refusal is a typed error.
            expect(() => setTempo({ bpm: 111 })).toThrowError(/tempo ramp/i);
            expect(governingChangeTempos()).toEqual([90, 130]);
        });

        it('tags the refusal so a runtime can report which event it could not write', () => {
            let thrown: unknown;
            try {
                setTempo({ bpm: 111 });
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toMatchObject({ _tag: 'TempoRampWrite', bpm: 111, tempoChangeId: 'tc-a' });
        });

        it('still refuses at the ramp’s own start point only when it is genuinely inside one', () => {
            // Drives between beat 4, strictly inside the ramp, and beat 0, the
            // ramp event's own start point where the readout is that event's own
            // 90 and the write is exactly defined.
            livePlayheadRef.current = 0;
            transportRef.value = { ...defaultTransportState, tempo: 120, playheadPosition: 0 };

            expect(setTempo({ bpm: 111 })).toEqual({ status: 'written' });
            expect(governingChangeTempos()).toEqual([111, 130]);
        });

        it('still writes a change named explicitly, which is unambiguous', () => {
            expect(setTempo({ bpm: 111, tempoChangeId: 'tc-a' })).toEqual({ status: 'written' });
            expect(governingChangeTempos()).toEqual([111, 130]);
        });
    });

    describe('during playback', () => {
        beforeEach(() => {
            transportRef.value = {
                ...defaultTransportState,
                tempo: 120,
                isPlaying: true,
                playheadPosition: 0,
            };
            tempoMapRef.value = {
                changes: [
                    { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
                    { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
                ],
            };
            // The scheduler advances only the ref; the store still holds the beat
            // playback started from.
            livePlayheadRef.current = 12;
        });

        it('writes the event governing where playback actually is', () => {
            setTempo({ bpm: 100 });

            expect(governingChangeTempos()).toEqual([90, 100]);
        });

        it('falls back to the store position once playback stops', () => {
            transportRef.value = { ...transportRef.value!, isPlaying: false };

            setTempo({ bpm: 100 });

            expect(governingChangeTempos()).toEqual([100, 130]);
        });
    });

    describe('with an explicitly named change', () => {
        beforeEach(() => {
            transportRef.value = { ...defaultTransportState, tempo: 120, playheadPosition: 20 };
            tempoMapRef.value = {
                changes: [
                    { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
                    { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
                ],
            };
            livePlayheadRef.current = 20;
        });

        it('writes the named change and ignores the playhead entirely', () => {
            setTempo({ bpm: 100, tempoChangeId: 'tc-a' });

            expect(governingChangeTempos()).toEqual([100, 130]);
        });

        it('reports no-write when the named change is gone rather than hitting another', () => {
            expect(setTempo({ bpm: 100, tempoChangeId: 'tc-deleted' })).toEqual({ status: 'no-write' });
            expect(governingChangeTempos()).toEqual([90, 130]);
        });
    });
});
