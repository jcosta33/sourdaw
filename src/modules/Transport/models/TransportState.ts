export type TransportState = {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    overdubEnabled: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    playheadPosition: number;
    loopStart: number;
    loopEnd: number;
    scheduleGrainMs: number;
    punchInEnabled: boolean;
    punchInBeat: number;
    punchOutBeat: number;
    countInEnabled: boolean;
    countInBars: number;
    preRollEnabled: boolean;
    preRollBars: number;
    masterGain: number;
};

export const defaultTransportState: TransportState = {
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 0,
    scheduleGrainMs: 10,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    countInEnabled: false,
    countInBars: 1,
    preRollEnabled: false,
    preRollBars: 2,
    masterGain: 80,
};
