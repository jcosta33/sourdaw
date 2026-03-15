export type AudioEngineState = {
    isReady: boolean;
    sampleRate: number;
    state: AudioContextState;
    masterGain: number;
};

export type AudioEngine = {
    readonly context: AudioContext;
    readonly masterGainNode: GainNode;
    initialize(): Promise<void>;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    setMasterGain(value: number): void;
    getMasterGain(): number;
    getState(): AudioEngineState;
    dispose(): void;
};
