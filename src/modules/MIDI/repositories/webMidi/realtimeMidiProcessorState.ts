export type RealtimeMidiInput = {
    context: BaseAudioContext;
    rackId: string;
    routeId?: string;
    trackId: string;
    note: number;
    velocity: number;
    channel: number;
    isNoteOn: boolean;
    sampleTime: number;
    sampleRate: number;
    noteInstanceId?: string;
    blockSize?: number;
    /**
     * Deliver this input only while the rack is the one the processor's worker
     * is running, never installing it. The worker holds a single rack; switching
     * it to another settles and rebuilds the rack it left, so a stale rack's
     * input has nothing to reach and must not cost the live rack its state.
     * Skipped, the answer is the input passed through.
     */
    onlyWhileRackCurrent?: boolean;
    /**
     * Drained batches from the idle pump the processor starts when this input
     * is a stopped transport's only rack driver (#4870). The receiver voices
     * them on their instrument routes; returning `false` cancels the drain.
     */
    onDrainedEvents?: (events: readonly RealtimeMidiEvent[]) => boolean | void;
};

export type RealtimeMidiEvent = {
    timeSamples: number;
    trackId?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
    /** Held lifetime a generated note-on carries from its processor (#4870). */
    durationSamples?: number;
    timePpq?: number;
    tempoBpm?: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number }
        | { type: 'cc'; channel: number; cc: number; value: number }
        | { type: 'pitchBend'; channel: number; value: number }
        | { type: 'channelPressure'; channel: number; value: number };
};

export type RealtimeMidiProcessor = (input: RealtimeMidiInput) => Promise<RealtimeMidiEvent[]>;

export function passThroughRealtimeMidi(input: RealtimeMidiInput): Promise<RealtimeMidiEvent[]> {
    return Promise.resolve([
        {
            timeSamples: input.sampleTime,
            trackId: input.trackId,
            noteInstanceId: input.noteInstanceId,
            kind: input.isNoteOn
                ? { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity }
                : { type: 'noteOff', channel: input.channel, note: input.note },
        },
    ]);
}

export const realtimeMidiProcessorState: { processor: RealtimeMidiProcessor } = {
    processor: passThroughRealtimeMidi,
};
