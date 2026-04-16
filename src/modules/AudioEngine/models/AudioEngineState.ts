export type AudioEngineState = {
    isReady: boolean;
    sampleRate: number;
    state: AudioContextState;
    masterGain: number;
    currentTime: number;
    baseLatency: number;
};

export type BuiltinDeviceNode = {
    deviceId: string;
    type: string;
    nodes: AudioNode[];
    inputNode: AudioNode;
    outputNode: AudioNode;
    bypassed?: boolean;
    /** Stop oscillators and release resources when the device is removed. */
    dispose?: () => void;
    /** Controls for native Rust/WASM DSP devices (param updates via MessagePort) */
    nativeDspControls?: {
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
    };
    /** Controls for the Fermenter synthesizer (MIDI + param updates via MessagePort) */
    fermenterControls?: {
        ready: boolean;
        noteOn: (note: number, velocity: number, sampleFrame?: number) => void;
        noteOff: (note: number, sampleFrame?: number) => void;
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
    /** Controls for the Toaster drum machine (MIDI + param updates via MessagePort) */
    toasterControls?: {
        ready: boolean;
        noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
        noteOff: (pad: number, sampleFrame?: number) => void;
        setParam: (name: string, value: number) => void;
        setPadParam: (pad: number, name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
    /** Controls for the Grand Boule piano (MIDI + pedals + param updates via MessagePort) */
    grandBouleControls?: {
        ready: boolean;
        noteOn: (midiNote: number, velocity: number, sampleFrame?: number) => void;
        noteOff: (midiNote: number, sampleFrame?: number) => void;
        setParam: (name: string, value: number) => void;
        setSustain: (position: number) => void;
        setUnaCorda: (engaged: boolean) => void;
        setSostenuto: (engaged: boolean) => void;
        noteOnMidi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
        setTemperament: (index: number) => void;
        loadAttackClip: (key: number, samples: Float32Array) => void;
        allNotesOff: () => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
    /** Controls for the Levain suite (MIDI + CC + param updates via MessagePort) */
    levainControls?: {
        ready: boolean;
        noteOn: (note: number, velocity: number, sampleFrame?: number) => void;
        noteOff: (note: number, sampleFrame?: number) => void;
        handleCc: (cc: number, value: number) => void;
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
};

export type TrackChannelStrip = {
    trackId: string;
    preFaderTap: GainNode;
    /** The track's generic input node, where clips and synths route audio BEFORE effects. */
    gainNode: GainNode;
    /** The actual track volume fader (post-inserts). */
    faderNode: GainNode;
    /** Post-device mute node — sits after all devices, before pan. Mute/solo targets this. */
    postFaderGain: GainNode;
    panNode: StereoPannerNode;
    meterNode: AudioWorkletNode;
    analyserNode: AnalyserNode;
    muted: boolean;
    soloed: boolean;
    deviceNodes: BuiltinDeviceNode[];
    meterBuffer: Float32Array;
    outputId?: string;
};

export type BusStrip = {
    busId: string;
    gainNode: GainNode;
    analyserNode: AnalyserNode;
    meterBuffer: Float32Array;
};

export type SendNode = {
    sourceTrackId: string;
    busId: string;
    gainNode: GainNode;
    preFader: boolean;
};

export type AudioEngine = {
    readonly context: AudioContext;
    readonly masterGainNode: GainNode;
    readonly masterAnalyser: AnalyserNode;
    initialize(): Promise<void>;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    setMasterGain(value: number): void;
    getMasterGain(): number;
    getState(): AudioEngineState;
    dispose(): void;
    resetGraph(): void;
    ensureTrackStrip(trackId: string): TrackChannelStrip;
    removeTrackStrip(trackId: string): void;
    getTrackStrip(trackId: string): TrackChannelStrip | undefined;
    setTrackGain(trackId: string, gain: number): void;
    setTrackPan(trackId: string, pan: number): void;
    setTrackMute(trackId: string, muted: boolean, restoreGain?: number): void;
    getTrackPeakLevel(trackId: string): number;
    getMasterPeakLevel(): number;
    getBusPeakLevel(busId: string): number;
    addDeviceToStrip(trackId: string, deviceId: string, deviceType: string, externalInstanceId?: string): void;
    removeDeviceFromStrip(trackId: string, deviceId: string): void;
    updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void;
    scheduleDeviceParam(trackId: string, deviceId: string, paramId: string, value: number, time: number): void;
    updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void;
    ensureBusStrip(busId: string): BusStrip;
    removeBusStrip(busId: string): void;
    setBusGain(busId: string, gain: number): void;
    setSend(sourceTrackId: string, busId: string, level: number, preFader?: boolean): void;
    removeSend(sourceTrackId: string, busId: string): void;
    setTrackOutput(trackId: string, outputId: string): void;
    scheduleOscillator(frequency: number, startTime: number, duration: number, gain?: number): void;
    scheduleClick(time: number, accent: boolean, volume?: number): void;
    stopAllScheduled(): void;
    wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void;
    unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void;
    waitForDevices(): Promise<void>;
    setMasterTrackId?(trackId: string): void;
};
