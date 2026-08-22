import type {
    RuntimeGraphDeltaResult,
    RuntimeGraphProjectRevisionValidator,
    RuntimeGraphTopologyValidator,
} from './RuntimeGraphDelta';

export type AudioEngineState = {
    isReady: boolean;
    sampleRate: number;
    state: AudioContextState;
    masterGain: number;
    currentTime: number;
    /**
     * `AudioContext.baseLatency` in seconds — "the number of seconds of
     * processing latency incurred by the `AudioContext` passing the audio from
     * the `AudioDestinationNode` to the audio subsystem" (Web Audio API §1.2.2).
     * The context's own segment of the output path, and only that segment.
     */
    baseLatency: number;
    /**
     * `AudioContext.outputLatency` in seconds — "the interval between the time
     * the UA requests the host system to play a buffer and the time at which the
     * first sample in the buffer is actually processed by the audio output
     * device" (Web Audio API §1.2.2). The *next* segment of the output path, not
     * an alternative measure of the same one, so the delay a user hears is
     * `baseLatency + outputLatency`. The spec calls this an estimation that "may
     * change while the context is running or the associated audio output device
     * changes", so read it per frame rather than caching it. `0` in fallback mode.
     */
    outputLatency: number;
};

/**
 * Liveness/error surface for the audio engine. Lets callers detect a poisoned
 * worklet load (so {@link AudioEngine.initialize} can be retried) and a failed
 * `AudioContext.resume()` (so a gesture handler can re-arm / warn the user)
 * instead of those failures being swallowed.
 */
/**
 * Runtime dropout tally (audit RT-10) — dropouts the engine itself *detected*
 * on the worklet side, not every glitch the user heard.
 *
 * Counted: render quanta where a device could not source audio and emitted
 * silence (today: Grand Boule ring-buffer starvation, excluding startup
 * pre-roll). Not counted: host/driver xruns, GC pauses, over-budget renders
 * that still produced samples, or starvation inside a third-party plugin host —
 * none of those are observable from `AudioWorkletGlobalScope`. Non-zero always
 * means a real problem; zero is not a clean bill of health. See
 * `engine/dropoutCounter.ts` for the full scope note.
 */
export type AudioEngineDropoutStats = {
    /** Render quanta that emitted silence because the device had no audio to play. */
    detectedUnderrunBlocks: number;
    /** Total frames of silence emitted by those quanta. */
    silentFrames: number;
    /** `currentFrame` at the most recent detected underrun; 0 when there has been none. */
    lastUnderrunAtFrame: number;
    /**
     * Blocks the native plugin bridge could not hand to the plugin host, because
     * the previous round trip had not come back. The block is not silence — the
     * previously processed block plays again — but the input never reached the
     * plugin, so a non-zero count means the relay is behind the render thread.
     */
    bridgeDroppedBlocks: number;
};

export type AudioEngineHealth = {
    /** True once every worklet module has loaded successfully. */
    workletReady: boolean;
    /** The error from the last failed `initialize()`, or `null` if the last attempt succeeded / none ran. */
    lastInitError: Error | null;
    /** The error from the last failed `resume()`, or `null` if the last attempt succeeded / none ran. */
    lastResumeError: Error | null;
    /** Detected-dropout tally read straight from the shared counters (audit RT-10). */
    dropouts: AudioEngineDropoutStats;
};

/**
 * Current-Chrome playback quality counters sampled from `AudioContext.playbackStats`.
 * Durations and latencies are seconds; Chrome refreshes the underlying counters at
 * most once per second while the context is running and the document is observable.
 * Underrun and total-duration fields are cumulative for the AudioContext lifetime;
 * measurement windows compare before/after snapshots. Latency fields cover the
 * window since `resetPlaybackLatencyStats()` was last called.
 */
export type AudioEnginePlaybackStats = {
    underrunDuration: number;
    underrunEvents: number;
    totalDuration: number;
    averageLatency: number;
    minimumLatency: number;
    maximumLatency: number;
};

export type AudioEngineDeviceReadinessDiagnostics = {
    /** Monotonic collector generation; advances whenever the live graph is reset. */
    generation: number;
    counts: {
        requested: number;
        nodeReady: number;
        graphReady: number;
        contentReady: number;
        playableReady: number;
        failed: number;
        cancelled: number;
    };
    timing: Record<
        'requestToNodeReadyMs' | 'requestToGraphReadyMs' | 'graphToContentReadyMs' | 'requestToPlayableReadyMs',
        { samples: number; totalMs: number; lastMs: number; maxMs: number; averageMs: number }
    >;
    devices: Array<{
        deviceId: string;
        deviceType: string;
        status: 'node-pending' | 'graph-pending' | 'content-pending' | 'ready' | 'failed';
        failureStage: 'node' | 'graph' | 'content' | 'runtime' | null;
        requestToNodeReadyMs: number | null;
        requestToGraphReadyMs: number | null;
        graphToContentReadyMs: number | null;
        requestToPlayableReadyMs: number | null;
        requestToFailureMs: number | null;
    }>;
};

export type AudioProcessorLifecycleState = 'continue' | 'continueIfNotQuiet' | 'tail' | 'sleep';

export type AudioEngineDiagnostics = {
    context: {
        state: AudioContextState;
        sampleRate: number;
        baseLatency: number;
        outputLatency: number;
        latencyProfile: 'lowLatency' | 'highCapacity' | null;
        latencyHint: 'interactive' | 'playback' | null;
    };
    /** Null only when the engine has no live AudioContext and is running its fallback shim. */
    playback: AudioEnginePlaybackStats | null;
    graph: {
        trackStrips: number;
        busStrips: number;
        sends: number;
        sidechains: number;
        /** Fully loaded device instances; pending and failed placeholders are excluded. */
        deviceInstances: number;
        pendingDeviceInstances: number;
        failedDeviceInstances: number;
        deviceInstancesByType: Record<string, number>;
        /** AudioNodes owned by every device slot still present in the graph, including pending/failed placeholders. */
        deviceAudioNodes: number;
        /**
         * Resources reachable from each TrackNode's current device slot, partitioned by load state.
         * Factory-owned resources that have not reached `onLoaded` are intentionally excluded and
         * belong to the staged-readiness telemetry slice.
         */
        graphSlotResourcesByLoadState: Record<
            'ready' | 'pending' | 'failed',
            { audioNodes: number; audioWorkletProcessors: number; workers: number }
        >;
        /** AudioWorklet processor instances owned by devices; meter worklets are reported separately. */
        deviceAudioWorkletProcessors: number;
        deviceAudioWorkletProcessorsByType: Record<string, number>;
        stripMeterWorklets: number;
        masterMeterWorklets: number;
        /** Track-device, adjustment-layer, strip-meter, and master-meter processors. */
        graphAudioWorkletProcessors: number;
        /** Dedicated Workers owned by current graph device slots; excludes transient recording/export workers. */
        workerInstances: number;
        workerInstancesByType: Record<string, number>;
        adjustmentLayerBuses: number;
        adjustmentLayerBusesByEffectType: Record<string, number>;
        adjustmentLayerAudioNodes: number;
        adjustmentLayerAudioWorkletProcessors: number;
    };
    runtime: {
        trackedAudioScheduledSources: number;
        /** Device processors are unmanaged until the lifecycle protocol lands in Wave 1. */
        processorLifecycle: {
            unmanaged: number;
            continue: number;
            continueIfNotQuiet: number;
            tail: number;
            sleep: number;
        };
    };
};

type ToasterScheduledPadParam = {
    name: string;
    value: number;
};

type ToasterScheduledHit = {
    pad: number;
    velocity: number;
    midiNote?: number;
    sampleFrame: number;
    padParams: ToasterScheduledPadParam[];
    restoreEngineType?: number;
    fillCondition?: 'fill' | 'not-fill';
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
    /** Native-host instance identity, retained so the runtime can reject ABA replacement. */
    externalInstanceId?: string;
    /** Immutable project-declared control schema captured with a topology delta. */
    parameterIds?: readonly string[];
    nodes: AudioNode[];
    inputNode: AudioNode;
    outputNode: AudioNode;
    /** Dedicated Worker instances owned by this loaded device, separate from AudioWorklet processors. */
    workerInstances?: number;
    /** Treat a stable proxy as a source even though GainNode accepts input. */
    isGenerator?: boolean;
    bypassed?: boolean;
    /** Stop oscillators and release resources when the device is removed. */
    dispose?: () => void;
    /** Current processor-owned lifecycle state when this device has adopted the shared contract. */
    processorLifecycle?: () => AudioProcessorLifecycleState | null;
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
        /** `channel` is the MPE member channel that owns the note; 0 is non-MPE. */
        noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
        /** Omitting `channel` releases every voice at that pitch, as before. */
        noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
        /**
         * MPE per-note expression in engine units — bend in semitones, pressure
         * 0..1, timbre/CC74 slide -1..1 (audit MD-2). Addressed by (channel,
         * note) so a ringing release tail or a second member channel at the
         * same pitch is left alone. Reached only through
         * `applyNoteExpression`, which owns the wire-unit conversion for both
         * the live and the scheduled path.
         */
        noteExpression: (
            note: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) => void;
        allNotesOff: () => void;
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
        scheduleHit: (hit: ToasterScheduledHit) => void;
        cancelScheduled: () => void;
        allNotesOff: () => void;
        setFillActive: (active: boolean) => void;
        setParam: (name: string, value: number) => void;
        setPadParam: (pad: number, name: string, value: number) => void;
        setPadDryRouted: (pad: number, routed: boolean) => void;
        setBypass: (bypassed: boolean) => void;
        connectPadOutput?: (pad: number, dest: AudioNode) => void;
        disconnectPadOutput?: (pad: number, dest: AudioNode) => void;
        destroy: () => void;
    };
    /** Controls for the Grand Boule piano (MIDI + pedals + param updates via MessagePort) */
    grandBouleControls?: {
        ready: boolean;
        noteOn: (midiNote: number, velocity: number, sampleFrame?: number, channel?: number) => void;
        /**
         * Release the note. `releaseVelocity` is the normalized (0..1) MIDI
         * note-off velocity; it is threaded to the engine worker so the release
         * dynamic is not dropped at the control boundary. Defaults to 0 (no
         * release dynamic) when the controller omits it. `sampleFrame` stays the
         * second positional arg so the shared worklet-synth scheduling path
         * (`scheduleMidiNotes`) can call `noteOff(note, sampleFrame)` uniformly
         * across fermenter / grand-boule / levain.
         */
        noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) => void;
        /**
         * MPE per-note expression (audit MD-2). Grand Boule sounds bend only —
         * pressure and slide are dropped at the engine, and its registry entry
         * advertises pitch bend alone so the editor never offers those lanes.
         */
        noteExpression: (
            midiNote: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) => void;
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
    /**
     * Controls for the Crumbs sampler/slicer (MIDI + param updates via
     * MessagePort).
     *
     * No `noteExpression`: `CrumbsEngine` has no per-note bend, pressure or
     * timbre path, so Crumbs is absent from `NOTE_EXPRESSION_DEVICES` and the
     * editor never offers those lanes for it. `channel` is accepted on
     * `noteOn`/`noteOff` only because the shared worklet-synth scheduling path
     * passes it positionally; the engine releases by pitch.
     */
    crumbsControls?: {
        ready: boolean;
        noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
        noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
        allNotesOff: () => void;
        setParam: (name: string, value: number) => void;
        setMode: (mode: string) => void;
        setBypass: (bypassed: boolean) => void;
        destroy: () => void;
    };
    /** Controls for the Levain suite (MIDI + CC + param updates via MessagePort) */
    levainControls?: {
        ready: boolean;
        noteOn: (
            note: number,
            velocity: number,
            sampleFrame?: number,
            channel?: number,
            articulationId?: number
        ) => void;
        noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
        /** MPE per-note expression in engine units — see `fermenterControls.noteExpression`. */
        noteExpression: (
            note: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) => void;
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

/**
 * The Toaster drum machine's runtime control surface, as attached to a loaded
 * device node. Exposed as a named port so foreign modules (e.g. Toaster) can
 * receive it from an AudioEngine use case without reaching into strip internals.
 */
export type ToasterDeviceControls = NonNullable<BuiltinDeviceNode['toasterControls']>;

export type MidiFxNode = {
    id: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

export type TrackChannelStrip = {
    trackId: string;
    /** Pre-fader send tap, and the solo-in-place gate (FX-8): closing this node
     *  stops the track feeding sends, buses and sidechain keys alike, which the
     *  downstream `postFaderGain` mute deliberately does not. */
    preFaderTap: GainNode;
    /** The track's generic input node, where clips and synths route audio BEFORE effects. */
    gainNode: GainNode;
    /** The actual track volume fader (post-inserts). */
    faderNode: GainNode;
    /** Post-device mute node — sits after all devices, before pan. The track's
     *  own mute targets this; solo-in-place targets `preFaderTap` instead. */
    postFaderGain: GainNode;
    panNode: StereoPannerNode;
    meterNode: AudioWorkletNode | null;
    analyserNode: AnalyserNode;
    muted: boolean;
    /** FX-8: silenced because solo is engaged elsewhere, not because the user
     *  muted this track. Tracked apart from `muted` so releasing solo cannot
     *  clear a real mute. */
    soloGated: boolean;
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
    sourceNode: AudioNode;
    preFader: boolean;
};

export type AudioEngine = {
    readonly context: AudioContext;
    readonly masterGainNode: GainNode;
    readonly masterAnalyser: AnalyserNode;
    /**
     * Left/right halves of a genuine stereo analysis tap, branched off
     * {@link masterAnalyser}'s (pass-through) output through a
     * `ChannelSplitterNode(2)`. `masterAnalyser`'s own time-domain data is
     * always down-mixed to mono per the Web Audio spec, so it cannot answer a
     * stereo question — the goniometer and phase-correlation meter read these
     * two nodes instead.
     */
    readonly masterAnalyserLeft: AnalyserNode;
    readonly masterAnalyserRight: AnalyserNode;
    initialize(): Promise<void>;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    setMasterGain(value: number): void;
    getMasterGain(): number;
    getState(): AudioEngineState;
    getHealth(): AudioEngineHealth;
    getDiagnostics(): AudioEngineDiagnostics;
    getDeviceReadinessDiagnostics(): AudioEngineDeviceReadinessDiagnostics;
    /**
     * False when the engine runs on its silent fallback shim. Every node it hands
     * out is structurally real there, so a caller that inspects a node instead —
     * connecting to it, reading its context state — cannot tell a dead graph from
     * a live one and reports silence as a measurement.
     */
    isAudioAvailable(): boolean;
    /** Start a new Chrome latency min/average/max measurement window. */
    resetPlaybackLatencyStats(): void;
    dispose(): Promise<void>;
    resetGraph(): void;
    /** Monotonic live-graph revision used to reject stale compiled deltas. */
    getRuntimeGraphRevision(): number;
    /** Composition-owned freshness authority; AudioEngine never reads project state directly. */
    setRuntimeGraphProjectRevisionValidator(validator: RuntimeGraphProjectRevisionValidator | null): void;
    /** Composition-owned exact topology authority; AudioEngine never reads project state directly. */
    setRuntimeGraphTopologyValidator(validator: RuntimeGraphTopologyValidator | null): void;
    /** Validated, immutable graph command applied only at the main-thread graph boundary. */
    applyRuntimeGraphDelta(delta: unknown): RuntimeGraphDeltaResult;
    /** Rehydration-only baseline; validates one complete strip before publishing it. */
    initializeTrackStripFromSnapshot(snapshot: unknown): RuntimeGraphDeltaResult;
    ensureTrackStrip(trackId: string): TrackChannelStrip;
    removeTrackStrip(trackId: string): void;
    getTrackStrip(trackId: string): TrackChannelStrip | undefined;
    findToasterControls(deviceId: string): ToasterDeviceControls | undefined;
    setTrackGain(trackId: string, gain: number): void;
    setTrackPan(trackId: string, pan: number): void;
    /** RT-5: PDC-aligned, a-rate automation write to the fader gain AudioParam.
     *  `time` is the absolute context time (compensation already folded in). */
    scheduleTrackGain(trackId: string, gain: number, time: number): void;
    /** RT-5 companion for the panner. `pan` is the canonical −50..50 range. */
    scheduleTrackPan(trackId: string, pan: number, time: number): void;
    /** RT-5: on transport stop, hold every track's fader gain/pan and drop any
     *  pending automation ramp so none lands after playback ends. */
    cancelTrackAutomationRamps(): void;
    setTrackMute(trackId: string, muted: boolean): void;
    /** FX-8: solo-in-place gating, applied at the pre-fader tap so a non-soloed
     *  track stops feeding return buses too. Separate from `setTrackMute`. */
    setTrackSoloGate(trackId: string, gated: boolean): void;
    getTrackPeakLevel(trackId: string): number;
    /** Linear master peak, or `null` when no meter tap is wired — see the
     *  implementation for why "unavailable" must not collapse into `0`. */
    getMasterPeakLevel(): number | null;
    getBusPeakLevel(busId: string): number;
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
    /** PDC-aligned send automation write. `time` is absolute context time. */
    scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void;
    removeSend(sourceTrackId: string, busId: string): void;
    setTrackOutput(
        trackId: string,
        outputId: string,
        padBinding?: { toasterParentTrackId: string; padIndex: number }
    ): void;
    scheduleOscillator(frequency: number, startTime: number, duration: number, gain?: number): void;
    scheduleClick(time: number, accent: boolean, volume?: number): void;
    stopAllScheduled(): void;
    /** Track a scheduled source so `stopAllScheduled` can silence it (audit MD-6). */
    registerScheduledSource(node: AudioScheduledSourceNode): void;
    wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void;
    unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void;
    /** FX-5 — re-resolve and glide every wired key-alignment delay. The resolver
     *  is supplied by the caller so the engine never reads project state. */
    refreshSidechainAlignment(
        keyDelayFor: (route: { sourceTrackId: string; targetTrackId: string; targetDeviceId: string }) => number
    ): void;
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
