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
    blockSize?: number;
};

export type RealtimeMidiEvent = {
    timeSamples: number;
    trackId?: string;
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
            kind: input.isNoteOn
                ? { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity }
                : { type: 'noteOff', channel: input.channel, note: input.note },
        },
    ]);
}

export const realtimeMidiProcessorState: { processor: RealtimeMidiProcessor } = {
    processor: passThroughRealtimeMidi,
};
