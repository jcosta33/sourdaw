/**
 * Yeast MIDI event model — sample-accurate event representation.
 *
 * Uses absolute sample time for deterministic cross-block scheduling.
 * All processors work on this format.
 */

export type MidiEventKind =
    | { type: 'noteOn'; channel: number; note: number; velocity: number }
    | { type: 'noteOff'; channel: number; note: number }
    | { type: 'cc'; channel: number; cc: number; value: number }
    | { type: 'pitchBend'; channel: number; value: number }
    | { type: 'channelPressure'; channel: number; value: number };

export type MidiEvent = {
    /** Absolute sample time on the global timeline. */
    timeSamples: number;
    kind: MidiEventKind;
    /** Originating instrument track for runtime routing and panic recovery. */
    trackId?: string;
};

export type TransportInfo = {
    sampleRate: number;
    bpm: number;
    /** Current position in PPQ (pulses per quarter note). */
    ppqPosition: number;
    isPlaying: boolean;
    barIndex: number;
    beatInBar: number;
    timeSigNum: number;
    timeSigDen: number;
    loopEnabled: boolean;
    loopStartPpq: number;
    loopEndPpq: number;
};

// ── Utility functions ────────────────────────────────────────────────────────

export function samplesPerBeat(time: TransportInfo): number {
    return (time.sampleRate * 60.0) / time.bpm;
}

export function ppqToSamples(ppq: number, time: TransportInfo): number {
    return ppq * samplesPerBeat(time);
}

export function samplesToBeats(samples: number, time: TransportInfo): number {
    return samples / samplesPerBeat(time);
}

/** Convert a musical rate (e.g., 1/8) to beat duration. */
export type RateValue =
    { type: 'straight'; denom: number } | { type: 'dotted'; denom: number } | { type: 'triplet'; denom: number };

export function rateToBeats(rate: RateValue): number {
    const base = 4.0 / rate.denom;
    switch (rate.type) {
        case 'straight':
            return base;
        case 'dotted':
            return base * 1.5;
        case 'triplet':
            return base * (2.0 / 3.0);
    }
    return base;
}
