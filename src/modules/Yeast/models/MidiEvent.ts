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
    /** Eager Note On lifetime hint when its Note Off may arrive in a later processing block. */
    durationSamples?: number;
    /** Musical Note On lifetime used when a processor shifts both endpoints in PPQ. */
    durationPpq?: number;
    /** Originating instrument track for runtime routing and panic recovery. */
    trackId?: string;
    /** Stable identity of this source endpoint across lookahead and Worker processing. */
    sourceEventId?: string;
    /** Shared identity for one note-on/note-off pair. */
    noteInstanceId?: string;
    /** Musical position retained when a tempo map is available. */
    timePpq?: number;
    /** Tempo at this event endpoint, used to project beat offsets to samples. */
    tempoBpm?: number;
};

type TempoMapChange = {
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type TempoMapProjection = {
    defaultTempo: number;
    /** Sorted ascending by beat at the composition boundary. */
    changes: readonly TempoMapChange[];
};

export type TransportInfo = {
    sampleRate: number;
    bpm: number;
    /** Absolute sample origin paired with ppqPosition for this processing block. */
    blockStartSamples?: number;
    /** Exclusive absolute sample boundary for this processing block. */
    blockEndSamples?: number;
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
    /**
     * Explicit transport discontinuity identity. Scheduler restarts/seeks use a
     * new value; realtime input may omit it because its AudioContext windows are
     * not a chronological transport stream.
     */
    discontinuityEpoch?: number;
    /** Optional project tempo map used by PPQ-shifting processors. */
    tempoMap?: TempoMapProjection;
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

function tempoAtPpq(changes: readonly TempoMapChange[], ppq: number, defaultTempo: number): number {
    if (changes.length === 0) {
        return defaultTempo;
    }
    let previous: TempoMapChange | undefined;
    let next: TempoMapChange | undefined;
    for (const change of changes) {
        if (change.beat <= ppq) {
            previous = change;
        } else {
            next = change;
            break;
        }
    }
    if (!previous) {
        return changes[0]!.tempo;
    }
    if (!next || previous.curve === 'instant') {
        return previous.tempo;
    }
    const progress = (ppq - previous.beat) / (next.beat - previous.beat);
    return previous.tempo + (next.tempo - previous.tempo) * progress;
}

function secondsAcrossTempoRange(
    changes: readonly TempoMapChange[],
    fromPpq: number,
    toPpq: number,
    defaultTempo: number
): number {
    if (fromPpq === toPpq) {
        return 0;
    }
    if (toPpq < fromPpq) {
        return -secondsAcrossTempoRange(changes, toPpq, fromPpq, defaultTempo);
    }

    let seconds = 0;
    let segmentStart = fromPpq;
    for (const change of changes) {
        if (change.beat <= fromPpq || change.beat >= toPpq) {
            continue;
        }
        seconds += secondsAcrossTempoSegment(changes, segmentStart, change.beat, defaultTempo);
        segmentStart = change.beat;
    }
    return seconds + secondsAcrossTempoSegment(changes, segmentStart, toPpq, defaultTempo);
}

function secondsAcrossTempoSegment(
    changes: readonly TempoMapChange[],
    fromPpq: number,
    toPpq: number,
    defaultTempo: number
): number {
    const startTempo = tempoAtPpq(changes, fromPpq, defaultTempo);
    let activeChange: TempoMapChange | undefined;
    for (const change of changes) {
        if (change.beat > fromPpq) {
            break;
        }
        activeChange = change;
    }
    if (!activeChange || activeChange.curve === 'instant') {
        return ((toPpq - fromPpq) * 60) / startTempo;
    }
    const endTempo = tempoAtPpq(changes, toPpq, defaultTempo);
    const tempoDelta = endTempo - startTempo;
    if (tempoDelta === 0) {
        return ((toPpq - fromPpq) * 60) / startTempo;
    }
    const relativeTempoDelta = tempoDelta / startTempo;
    return (((toPpq - fromPpq) * 60) / startTempo) * (Math.log1p(relativeTempoDelta) / relativeTempoDelta);
}

export function projectPpqToSamples(ppq: number, transport: TransportInfo): number {
    const tempoMap = transport.tempoMap;
    if (!tempoMap) {
        return Math.round(ppq * samplesPerBeat(transport));
    }
    return Math.round(secondsAcrossTempoRange(tempoMap.changes, 0, ppq, tempoMap.defaultTempo) * transport.sampleRate);
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
