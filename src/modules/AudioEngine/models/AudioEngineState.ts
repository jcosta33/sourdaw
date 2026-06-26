export type AudioEngineState = {
    isReady: boolean;
    sampleRate: number;
    state: AudioContextState;
    masterGain: number;
    currentTime: number;
    baseLatency: number;
};

/**
 * Liveness/error surface for the audio engine. Lets callers detect a poisoned
 * worklet load (so {@link AudioEngine.initialize} can be retried) and a failed
 * `AudioContext.resume()` (so a gesture handler can re-arm / warn the user)
 * instead of those failures being swallowed.
 */
export type AudioEngineHealth = {
    /** True once every worklet module has loaded successfully. */
    workletReady: boolean;
    /** The error from the last failed `initialize()`, or `null` if the last attempt succeeded / none ran. */
    lastInitError: Error | null;
    /** The error from the last failed `resume()`, or `null` if the last attempt succeeded / none ran. */
    lastResumeError: Error | null;
};

export type DeviceController = {
    ready?: boolean;
    setParam(name: string, value: number, sampleFrame?: number): void;
    scheduleParam?(name: string, value: number, time: number): void;
    setPatch?(patch: Record<string, unknown>): void;
    setBypass?(bypassed: boolean): void;
    destroy?(): void;

    // Optional device-specific methods (Shims/Extensions)
    noteOn?(note: number, velocity: number, sampleFrame?: number): void;
    noteOff?(note: number, sampleFrame?: number): void;
    allNotesOff?(): void;
    handleCc?(cc: number, value: number): void;
    setPadParam?(pad: number, name: string, value: number): void;
    setSustain?(position: number): void;
    setUnaCorda?(engaged: boolean): void;
    setSostenuto?(engaged: boolean): void;
    noteOnMidi2?(midiNote: number, velocity16bit: number, pitchOffsetQ24: number): void;
    setTemperament?(index: number): void;
    loadAttackClip?(key: number, samples: Float32Array): void;
    updateState?(clips: Record<string, unknown>): void;
    keyOn?(channel: number, pitch: number, velocity: number, time?: number): void;
    keyOff?(channel: number, pitch: number, velocity: number, time?: number): void;
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
    /** Unified controller for all device types */
    controller?: DeviceController;
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
        setParam: (name: string, value: number | number[], sampleFrame?: number) => void;
        setPatch?: (patch: Record<string, unknown>) => void;
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
        /**
         * Release the note. `releaseVelocity` is the normalized (0..1) MIDI
         * note-off velocity; it is threaded to the engine worker so the release
         * dynamic is not dropped at the control boundary. Defaults to 0 (no
         * release dynamic) when the controller omits it. `sampleFrame` stays the
         * second positional arg so the shared worklet-synth scheduling path
         * (`scheduleMidiNotes`) can call `noteOff(note, sampleFrame)` uniformly
         * across fermenter / grand-boule / levain.
         */
        noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number) => void;
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
        allNotesOff: () => void;
        handleCc: (cc: number, value: number) => void;
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
    /** Controls for the Knead pitch processor (blob sync + param updates via MessagePort) */
    kneadControls?: {
        ready: boolean;
        updateState: (clips: Record<string, unknown>) => void;
        setParam: (name: string, value: number | number[]) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
};

export type MidiFxNode = {
    id: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
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
    meterNode: AudioWorkletNode | null;
    analyserNode: AnalyserNode;
    muted: boolean;
    soloed: boolean;
    deviceNodes: BuiltinDeviceNode[];
    midiFxNodes: MidiFxNode[];
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
    getHealth(): AudioEngineHealth;
    dispose(): Promise<void>;
    resetGraph(): void;
    ensureTrackStrip(trackId: string): TrackChannelStrip;
    removeTrackStrip(trackId: string): void;
    getTrackStrip(trackId: string): TrackChannelStrip | undefined;
    setTrackGain(trackId: string, gain: number): void;
    setTrackPan(trackId: string, pan: number): void;
    setTrackMute(trackId: string, muted: boolean): void;
    getTrackPeakLevel(trackId: string): number;
    getMasterPeakLevel(): number;
    getBusPeakLevel(busId: string): number;
    addDeviceToStrip(trackId: string, deviceId: string, deviceType: string, externalInstanceId?: string): void;
    removeDeviceFromStrip(trackId: string, deviceId: string): void;
    updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void;
    updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void;
    scheduleDeviceParam(trackId: string, deviceId: string, paramId: string, value: number, time: number): void;
    scheduleDeviceKeyOn(trackId: string, deviceId: string, pitch: number, velocity: number, time?: number): void;
    scheduleDeviceKeyOff(trackId: string, deviceId: string, pitch: number, velocity: number, time?: number): void;
    updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void;
    addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void;
    removeMidiFxFromStrip(trackId: string, fxId: string): void;
    updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void;
    updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void;
    syncKneadState(trackId: string, clips: Record<string, unknown>): void;
    registerTuningTable(frequencies: number[]): void;
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
    setTransportInfo(
        beat: number,
        bpm: number,
        playing: boolean,
        loopStart?: number,
        loopEnd?: number,
        isLooping?: boolean
    ): void;
    applyAdjustmentLayerTick?(records: AdjustmentLayerTickInput[]): void;
    resetAdjustmentLayers?(): void;
    listLiveAdjustmentBusKeys?(): string[];
};

export type AdjustmentLayerTickInput = {
    trackId: string;
    layerId: string;
    effectType: 'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';
    parameters: Record<string, number>;
    blend: number;
};
