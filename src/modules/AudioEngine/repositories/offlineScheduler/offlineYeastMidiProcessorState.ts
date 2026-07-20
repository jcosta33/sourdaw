type OfflineYeastMidiEvent = {
    timeSamples: number;
    trackId?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
    timePpq?: number;
    tempoBpm?: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number }
        | { type: 'cc'; channel: number; cc: number; value: number }
        | { type: 'pitchBend'; channel: number; value: number }
        | { type: 'channelPressure'; channel: number; value: number };
};

type OfflineYeastMidiOutputEvent = OfflineYeastMidiEvent & {
    timePpq: number;
};

export type OfflineYeastMidiProcessor = (input: {
    trackId: string;
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    events: readonly OfflineYeastMidiEvent[];
}) => readonly OfflineYeastMidiOutputEvent[];

export type OfflineYeastMidiProcessorFactory = () => OfflineYeastMidiProcessor;

export const offlineYeastMidiProcessorState: { createProcessor: OfflineYeastMidiProcessorFactory | null } = {
    createProcessor: null,
};
