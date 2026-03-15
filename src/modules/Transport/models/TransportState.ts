export type TransportState = {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    metronomeEnabled: boolean;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    playheadPosition: number;
    loopStart: number;
    loopEnd: number;
};

export const defaultTransportState: TransportState = {
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    metronomeEnabled: false,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 16,
};
