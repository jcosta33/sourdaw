import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import {
    type AudioEngine,
    type AudioEngineState,
    type TrackChannelStrip,
    type BuiltinDeviceNode,
    type BusStrip,
    type SendNode,
} from '../models/AudioEngineState';
import { PluginHostNode } from '../models/PluginHostNode';
import audioCoreProcessorUrl from '../services/audioCoreProcessor.ts?worker&url';
import {
    isNativeDspDevice,
    NATIVE_DSP_DEVICE_TYPES,
    createNativeDspNode,
    type NativeDspNodeResult,
} from '../engine/NativeDspNode';
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Arrangement/useCases/trackQueries';
import { DEVICE_FACTORIES, applyParams } from './deviceNodeFactory';

const logger = Container.getInstance().get(Logger);

function createNoopEngine(): AudioEngine {
    const noopState: AudioEngineState = {
        isReady: false,
        sampleRate: 44100,
        state: 'closed',
        masterGain: 0,
        currentTime: 0,
        baseLatency: 0,
    };

    const ctx = new OfflineAudioContext(2, 1, 44100);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    const silentAnalyser = ctx.createAnalyser();

    return {
        context: ctx as unknown as AudioContext,
        masterGainNode: silentGain,
        masterAnalyser: silentAnalyser,
        initialize: async () => {},
        resume: async () => {},
        suspend: async () => {},
        setMasterGain: () => {},
        getMasterGain: () => 0,
        getState: () => noopState,
        dispose: () => {},
        ensureTrackStrip: (trackId) => ({
            trackId,
            preFaderTap: silentGain,
            gainNode: silentGain,
            faderNode: silentGain,
            postFaderGain: silentGain,
            panNode: ctx.createStereoPanner() as unknown as StereoPannerNode,
            analyserNode: silentAnalyser,
            muted: false,
            soloed: false,
            deviceNodes: [],
            meterBuffer: new Float32Array(0),
        }),
        removeTrackStrip: () => {},
        getTrackStrip: () => undefined,
        setTrackGain: () => {},
        setTrackPan: () => {},
        setTrackMute: () => {},
        getTrackPeakLevel: () => 0,
        getMasterPeakLevel: () => 0,
        getBusPeakLevel: () => 0,
        addDeviceToStrip: () => {},
        removeDeviceFromStrip: () => {},
        updateDeviceParam: () => {},
        updateDeviceBypass: () => {},
        ensureBusStrip: (busId) => ({
            busId,
            gainNode: silentGain,
            analyserNode: silentAnalyser,
            meterBuffer: new Float32Array(0),
        }),
        removeBusStrip: () => {},
        setBusGain: () => {},
        setSend: () => {},
        removeSend: () => {},
        setTrackOutput: () => {},
        scheduleOscillator: () => {},
        scheduleClick: () => {},
        stopAllScheduled: () => {},
        wireSidechainRoute: () => {},
        unwireSidechainRoute: () => {},
        waitForDevices: async () => {},
    };
}

export function createWebAudioEngine(): AudioEngine {
    let context: AudioContext;
    try {
        context = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
        logger.warn(`Failed to create AudioContext: ${error}`);
        return createNoopEngine();
    }

    const masterGainNode = context.createGain();
    masterGainNode.gain.value = 0.8;

    const masterAnalyser = context.createAnalyser();
    masterAnalyser.fftSize = 256;
    masterAnalyser.smoothingTimeConstant = 0.8;

    masterGainNode.connect(masterAnalyser);
    masterAnalyser.connect(context.destination);

    const trackStrips = new Map<string, TrackChannelStrip>();
    const busStrips = new Map<string, BusStrip>();
    const sendNodes = new Map<string, SendNode>();
    const sidechainConnections = new Map<string, GainNode>();
    const scheduledNodes: AudioScheduledSourceNode[] = [];
    const masterMeterBuffer = new Float32Array(masterAnalyser.frequencyBinCount);
    const pendingFaustParams = new Map<string, Map<string, number>>();
    const pendingDevicePromises = new Set<Promise<any>>();

    let workletReady = false;

    async function initialize(): Promise<void> {
        try {
            await context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
            await context.audioWorklet.addModule('/audio/worklets/native-plugin-host-processor.js');
            await context.audioWorklet.addModule(audioCoreProcessorUrl);
            workletReady = true;
        } catch (error) {
            logger.warn(`AudioWorklet modules failed to load: ${error}`);
            workletReady = false;
        }

        try {
            if (context.state === 'suspended') {
                await context.resume();
            }
        } catch (error) {
            logger.warn(`AudioContext resume failed during init: ${error}`);
        }
    }

    async function resume(): Promise<void> {
        try {
            if (context.state === 'suspended') {
                await context.resume();
            }
        } catch (error) {
            logger.warn(`AudioContext resume failed: ${error}`);
        }
    }

    async function suspend(): Promise<void> {
        try {
            if (context.state === 'running') {
                await context.suspend();
            }
        } catch (error) {
            logger.warn(`AudioContext suspend failed: ${error}`);
        }
    }

    function setMasterGain(value: number): void {
        masterGainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), context.currentTime, 0.01);
    }

    const getMasterGain = (): number => masterGainNode.gain.value;

    const getState = (): AudioEngineState => ({
        isReady: context.state === 'running' || workletReady,
        sampleRate: context.sampleRate,
        state: context.state,
        masterGain: masterGainNode.gain.value,
        currentTime: context.currentTime,
        baseLatency: context.baseLatency ?? 0,
    });

    function ensureTrackStrip(trackId: string): TrackChannelStrip {
        const existing = trackStrips.get(trackId);
        if (existing) {
            return existing;
        }

        const preFaderTap = context.createGain();
        preFaderTap.gain.value = 1;

        const gainNode = context.createGain(); // the input node
        gainNode.gain.value = 1;

        const faderNode = context.createGain();
        faderNode.gain.value = 0.8;

        // Post-device mute node — sits after all devices, before pan.
        // Mute/solo targets this so it works for Faust generators that bypass gainNode.
        const postFaderGain = context.createGain();
        postFaderGain.gain.value = 1;

        const panNode = context.createStereoPanner();
        panNode.pan.value = 0;

        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.8;

        gainNode.connect(preFaderTap);
        preFaderTap.connect(faderNode);
        faderNode.connect(postFaderGain);
        postFaderGain.connect(panNode);
        panNode.connect(analyserNode);

        const strip: TrackChannelStrip = {
            trackId,
            preFaderTap,
            gainNode,
            faderNode,
            postFaderGain,
            panNode,
            analyserNode,
            muted: false,
            soloed: false,
            deviceNodes: [],
            meterBuffer: new Float32Array(analyserNode.frequencyBinCount),
        };
        trackStrips.set(trackId, strip);

        if (strip.outputId === 'hw_out') {
            analyserNode.connect(masterGainNode);
        } else if (strip.outputId && trackStrips.has(strip.outputId)) {
            analyserNode.connect(trackStrips.get(strip.outputId)!.gainNode);
        } else {
            analyserNode.connect(masterGainNode);
        }

        return strip;
    }

    function removeTrackStrip(trackId: string): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        strip.preFaderTap.disconnect();
        strip.gainNode.disconnect();
        strip.faderNode.disconnect();
        strip.postFaderGain.disconnect();
        strip.panNode.disconnect();
        strip.analyserNode.disconnect();
        trackStrips.delete(trackId);
    }

    function getTrackStrip(trackId: string): TrackChannelStrip | undefined {
        return trackStrips.get(trackId);
    }

    function setTrackGain(trackId: string, gain: number): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        strip.faderNode.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), context.currentTime, 0.01);
    }

    function setTrackPan(trackId: string, pan: number): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        strip.panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan / 50)), context.currentTime, 0.01);
    }

    function setTrackMute(trackId: string, muted: boolean, _restoreGain?: number): void {
        // Ensure the strip exists — it may not have been created yet if playback hasn't started.
        // We still need to apply the mute state so it takes effect as soon as audio is produced.
        const strip = ensureTrackStrip(trackId);
        strip.muted = muted;
        // Target postFaderGain (not gainNode) so mute works for Faust generators
        // that bypass the pre-fader gainNode in the device chain.
        if (muted) {
            strip.postFaderGain.gain.setTargetAtTime(0, context.currentTime, 0.005);
        } else {
            strip.postFaderGain.gain.setTargetAtTime(1, context.currentTime, 0.005);
        }
    }

    function getTrackPeakLevel(trackId: string): number {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return 0;
        }
        const data = strip.meterBuffer;
        strip.analyserNode.getFloatTimeDomainData(data as any);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
        return peak;
    }

    function getMasterPeakLevel(): number {
        const data = masterMeterBuffer;
        masterAnalyser.getFloatTimeDomainData(data as any);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
        return peak;
    }

    function scheduleOscillator(frequency: number, startTime: number, duration: number, gain = 0.3): void {
        const osc = context.createOscillator();
        const env = context.createGain();

        osc.type = 'sine';
        osc.frequency.value = frequency;

        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(gain, startTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(env);
        env.connect(masterGainNode);

        osc.start(startTime);
        osc.stop(startTime + duration);

        scheduledNodes.push(osc);
        osc.onended = () => {
            const idx = scheduledNodes.indexOf(osc);
            if (idx >= 0) {
                scheduledNodes.splice(idx, 1);
            }
            env.disconnect();
        };
    }

    function scheduleClick(time: number, accent: boolean, volume = 1): void {
        const freq = accent ? 1500 : 1000;
        const dur = accent ? 0.04 : 0.03;
        const baseVol = accent ? 0.4 : 0.25;
        scheduleOscillator(freq, time, dur, baseVol * volume);
    }

    function stopAllScheduled(): void {
        const now = context.currentTime;
        for (const node of [...scheduledNodes]) {
            try {
                node.stop(now);
            } catch {
                // already stopped
            }
        }
        scheduledNodes.length = 0;
    }

    function rebuildStripChain(strip: TrackChannelStrip): void {
        // Disconnect only the inter-device chain connections, NOT internal device wiring.
        // For multi-node devices (delay, compressor, reverb, chorus, etc.),
        // calling inputNode.disconnect() would sever internal connections like
        // splitter→dry, comp→makeup, etc. that are never restored.
        strip.preFaderTap.disconnect();
        strip.gainNode.disconnect();
        strip.faderNode.disconnect();
        strip.postFaderGain.disconnect();
        for (const dn of strip.deviceNodes) {
            // Only disconnect the device's output → next node connection
            try {
                dn.outputNode.disconnect();
            } catch {
                /* ok */
            }
        }
        strip.panNode.disconnect();
        strip.analyserNode.disconnect();

        let prev: AudioNode = strip.gainNode;
        for (const dn of strip.deviceNodes) {
            // Skip bypassed web audio devices — route audio past them
            if ((dn as BuiltinDeviceNode & { _bypassed?: boolean })._bypassed) {
                continue;
            }
            // Instrument nodes (Faust synths) have 0 inputs — they generate audio.
            // Don't try to connect the previous node to them; just take their output.
            if (dn.inputNode.numberOfInputs > 0) {
                prev.connect(dn.inputNode);
            }
            prev = dn.outputNode;
        }
        // Route through preFaderTap (sends) then fader (volume) then postFader (mute)
        prev.connect(strip.preFaderTap);
        strip.preFaderTap.connect(strip.faderNode);
        strip.faderNode.connect(strip.postFaderGain);
        strip.postFaderGain.connect(strip.panNode);
        strip.panNode.connect(strip.analyserNode);
        
        if (strip.outputId === 'hw_out') {
            strip.analyserNode.connect(masterGainNode);
        } else if (strip.outputId && trackStrips.has(strip.outputId)) {
            strip.analyserNode.connect(trackStrips.get(strip.outputId)!.gainNode);
        } else {
            strip.analyserNode.connect(masterGainNode);
        }

        reconnectSendsForTrack(strip);
    }

    function createEqDevice(deviceId: string): BuiltinDeviceNode {
        const low = context.createBiquadFilter();
        low.type = 'lowshelf';
        low.frequency.value = 100;
        low.gain.value = 0;
        const mid = context.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 1;
        mid.gain.value = 0;
        const high = context.createBiquadFilter();
        high.type = 'highshelf';
        high.frequency.value = 8000;
        high.gain.value = 0;
        low.connect(mid);
        mid.connect(high);
        return { deviceId, type: 'builtin-eq', nodes: [low, mid, high], inputNode: low, outputNode: high };
    }

    function createCompressorDevice(deviceId: string): BuiltinDeviceNode {
        const comp = context.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.ratio.value = 4;
        comp.attack.value = 0.01;
        comp.release.value = 0.1;
        const makeup = context.createGain();
        makeup.gain.value = 1;
        comp.connect(makeup);
        return { deviceId, type: 'builtin-compressor', nodes: [comp, makeup], inputNode: comp, outputNode: makeup };
    }

    function createReverbDevice(deviceId: string): BuiltinDeviceNode {
        const dry = context.createGain();
        dry.gain.value = 0.7;
        const wet = context.createGain();
        wet.gain.value = 0.3;
        const convolver = context.createConvolver();
        const len = context.sampleRate * 2;
        const impulse = context.createBuffer(2, len, context.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.5));
            }
        }
        convolver.buffer = impulse;
        const merger = context.createGain();
        const splitter = context.createGain();
        splitter.connect(dry);
        splitter.connect(convolver);
        convolver.connect(wet);
        dry.connect(merger);
        wet.connect(merger);
        return {
            deviceId,
            type: 'builtin-reverb',
            nodes: [splitter, dry, wet, convolver, merger],
            inputNode: splitter,
            outputNode: merger,
        };
    }

    function createDelayDevice(deviceId: string): BuiltinDeviceNode {
        const dry = context.createGain();
        dry.gain.value = 0.7;
        const wet = context.createGain();
        wet.gain.value = 0.3;
        const delay = context.createDelay(5);
        delay.delayTime.value = 0.25;
        const feedback = context.createGain();
        feedback.gain.value = 0.4;
        const splitter = context.createGain();
        const merger = context.createGain();
        splitter.connect(dry);
        splitter.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        dry.connect(merger);
        wet.connect(merger);
        return {
            deviceId,
            type: 'builtin-delay',
            nodes: [splitter, dry, wet, delay, feedback, merger],
            inputNode: splitter,
            outputNode: merger,
        };
    }

    function createGainDevice(deviceId: string): BuiltinDeviceNode {
        const g = context.createGain();
        g.gain.value = 1;
        return { deviceId, type: 'builtin-gain', nodes: [g], inputNode: g, outputNode: g };
    }

    function createSidechainCompressorDevice(deviceId: string): BuiltinDeviceNode {
        const workletNode = new AudioWorkletNode(context, 'sidechain-compressor-processor', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        return {
            deviceId,
            type: 'builtin-sidechain-compressor',
            nodes: [workletNode],
            inputNode: workletNode,
            outputNode: workletNode,
        };
    }

    function createChorusDevice(deviceId: string): BuiltinDeviceNode {
        const splitter = context.createGain();
        const dry = context.createGain();
        dry.gain.value = 0.5;
        const wet = context.createGain();
        wet.gain.value = 0.5;
        const delay = context.createDelay(0.05);
        delay.delayTime.value = 0.007;
        const lfo = context.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.5;
        const lfoGain = context.createGain();
        lfoGain.gain.value = 0.005;
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();
        const merger = context.createGain();
        splitter.connect(dry);
        splitter.connect(delay);
        delay.connect(wet);
        dry.connect(merger);
        wet.connect(merger);
        return {
            deviceId,
            type: 'builtin-chorus',
            nodes: [splitter, dry, wet, delay, lfo, lfoGain, merger],
            inputNode: splitter,
            outputNode: merger,
        };
    }

    function createPhaserDevice(deviceId: string): BuiltinDeviceNode {
        const input = context.createGain();
        const output = context.createGain();
        const stageCount = 4;
        const filters: BiquadFilterNode[] = [];
        for (let i = 0; i < stageCount; i++) {
            const ap = context.createBiquadFilter();
            ap.type = 'allpass';
            ap.frequency.value = 1000;
            ap.Q.value = 0.5;
            filters.push(ap);
        }
        const lfo = context.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.5;
        const lfoGain = context.createGain();
        lfoGain.gain.value = 500;
        lfo.connect(lfoGain);
        for (const f of filters) {
            lfoGain.connect(f.frequency);
        }
        lfo.start();
        const feedbackGain = context.createGain();
        feedbackGain.gain.value = 0.3;
        const dry = context.createGain();
        dry.gain.value = 0.5;
        const wet = context.createGain();
        wet.gain.value = 0.5;
        input.connect(dry);
        let prev: AudioNode = input;
        for (const f of filters) {
            prev.connect(f);
            prev = f;
        }
        prev.connect(feedbackGain);
        feedbackGain.connect(filters[0]!);
        prev.connect(wet);
        dry.connect(output);
        wet.connect(output);
        return {
            deviceId,
            type: 'builtin-phaser',
            nodes: [input, ...filters, lfo, lfoGain, feedbackGain, dry, wet, output],
            inputNode: input,
            outputNode: output,
        };
    }

    function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const k = Math.max(0.1, drive);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = Math.tanh(k * x);
        }
        return curve;
    }

    function createDistortionDevice(deviceId: string): BuiltinDeviceNode {
        const splitter = context.createGain();
        const dry = context.createGain();
        dry.gain.value = 0.5;
        const wet = context.createGain();
        wet.gain.value = 0.5;
        const shaper = context.createWaveShaper();
        shaper.curve = makeDistortionCurve(20);
        shaper.oversample = '4x';
        const tone = context.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 4000;
        const merger = context.createGain();
        splitter.connect(dry);
        splitter.connect(shaper);
        shaper.connect(tone);
        tone.connect(wet);
        dry.connect(merger);
        wet.connect(merger);
        return {
            deviceId,
            type: 'builtin-distortion',
            nodes: [splitter, dry, wet, shaper, tone, merger],
            inputNode: splitter,
            outputNode: merger,
        };
    }

    function createLimiterDevice(deviceId: string): BuiltinDeviceNode {
        const comp = context.createDynamicsCompressor();
        comp.threshold.value = -6;
        comp.ratio.value = 20;
        comp.attack.value = 0.001;
        comp.release.value = 0.1;
        comp.knee.value = 0;
        const ceiling = context.createGain();
        ceiling.gain.value = 10 ** (-0.3 / 20);
        comp.connect(ceiling);
        return { deviceId, type: 'builtin-limiter', nodes: [comp, ceiling], inputNode: comp, outputNode: ceiling };
    }

    function createNativePluginDevice(deviceId: string, externalInstanceId: string): BuiltinDeviceNode {
        const workletNode = new PluginHostNode(context, externalInstanceId);
        return {
            deviceId,
            type: 'external-plugin',
            nodes: [workletNode],
            inputNode: workletNode,
            outputNode: workletNode,
        };
    }

    function addDeviceToStrip(
        trackId: string,
        deviceId: string,
        deviceType: string,
        externalInstanceId?: string
    ): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        if (strip.deviceNodes.some((d) => d.deviceId === deviceId)) {
            return;
        }

        // Skip devices not supported on the current platform
        if (!isDeviceSupportedOnCurrentPlatform(deviceType)) {
            logger.info(`[WebAudioEngine] Skipping ${deviceType} — not supported on this platform`);
            return;
        }

        let dn: BuiltinDeviceNode;
        switch (deviceType) {
            case 'builtin-eq':
                dn = createEqDevice(deviceId);
                break;
            case 'builtin-compressor':
                dn = createCompressorDevice(deviceId);
                break;
            case 'builtin-reverb':
                dn = createReverbDevice(deviceId);
                break;
            case 'builtin-delay':
                dn = createDelayDevice(deviceId);
                break;
            case 'builtin-gain':
                dn = createGainDevice(deviceId);
                break;
            case 'builtin-sidechain-compressor':
                dn = createSidechainCompressorDevice(deviceId);
                break;
            case 'builtin-chorus':
                dn = createChorusDevice(deviceId);
                break;
            case 'builtin-phaser':
                dn = createPhaserDevice(deviceId);
                break;
            case 'builtin-distortion':
                dn = createDistortionDevice(deviceId);
                break;
            case 'builtin-limiter':
                dn = createLimiterDevice(deviceId);
                break;
            case 'external-plugin':
                dn = createNativePluginDevice(deviceId, externalInstanceId ?? deviceId);
                break;
            default: {
                if (deviceType.startsWith('faust-')) {
                    // Faust DSP device — create a bypass node as placeholder while WASM compiles
                    const loadingBypassNode = context.createGain();
                    dn = {
                        deviceId,
                        type: deviceType,
                        nodes: [loadingBypassNode],
                        inputNode: loadingBypassNode,
                        outputNode: loadingBypassNode,
                    };

                    const loadPromise = import('./faustDeviceFactory')
                        .then(({ createFaustDevice }) => {
                            return createFaustDevice(context, deviceType).then((realDn) => {
                                if (!realDn) return;
                                const stripToUpdate = trackStrips.get(trackId);
                                if (!stripToUpdate) return;

                                const idx = stripToUpdate.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                                if (idx !== -1) {
                                    const builtinDn = realDn as BuiltinDeviceNode;
                                    builtinDn.deviceId = deviceId;
                                    builtinDn.type = deviceType;
                                    stripToUpdate.deviceNodes[idx] = builtinDn;
                                    rebuildStripChain(stripToUpdate);

                                    const pending = pendingFaustParams.get(deviceId);
                                    if (pending) {
                                        const worklet = builtinDn.nodes[0] as AudioWorkletNode;
                                        for (const [pId, val] of pending) {
                                            const param = worklet.parameters.get(pId);
                                            if (param) param.setTargetAtTime(val, context.currentTime, 0.01);
                                        }
                                        pendingFaustParams.delete(deviceId);
                                    }
                                }
                            });
                        })
                        .catch((err) => {
                            console.error('[WebAudioEngine] Failed to load Faust factory:', err);
                        });
                    pendingDevicePromises.add(loadPromise);
                    loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
                } else {
                    // Try the shared DEVICE_FACTORIES first (covers all builtin web effects)
                    const factory = DEVICE_FACTORIES[deviceType];
                    if (factory) {
                        const factoryNode = factory(context);
                        dn = {
                            deviceId,
                            type: deviceType,
                            nodes: factoryNode.nodes,
                            inputNode: factoryNode.inputNode,
                            outputNode: factoryNode.outputNode,
                        };
                    } else if (isNativeDspDevice(deviceType)) {
                        const pluginType = NATIVE_DSP_DEVICE_TYPES[deviceType];
                        if (!pluginType) return;
                        // Create a bypass node as placeholder while WASM loads
                        const loadingBypass = context.createGain();
                        dn = {
                            deviceId,
                            type: deviceType,
                            nodes: [loadingBypass],
                            inputNode: loadingBypass,
                            outputNode: loadingBypass,
                        };
                        // Async: load WASM and hot-swap into the chain
                        const loadPromise = createNativeDspNode(context, pluginType)
                            .then(async (result: NativeDspNodeResult) => {
                                await result.ready;
                                const stripToUpdate = trackStrips.get(trackId);
                                if (!stripToUpdate) return;
                                const idx = stripToUpdate.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                                if (idx !== -1) {
                                    const nativeDn: BuiltinDeviceNode = {
                                        deviceId,
                                        type: deviceType,
                                        nodes: [result.workletNode],
                                        inputNode: result.workletNode,
                                        outputNode: result.workletNode,
                                        nativeDspControls: result,
                                    };
                                    stripToUpdate.deviceNodes[idx] = nativeDn;
                                    rebuildStripChain(stripToUpdate);
                                }
                            })
                            .catch((err) => {
                                logger.warn(`[WebAudioEngine] Failed to load native DSP ${deviceType}: ${err}`);
                            });
                        pendingDevicePromises.add(loadPromise);
                        loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
                    } else {
                        return;
                    }
                }
                break;
            }
        }
        strip.deviceNodes.push(dn);
        rebuildStripChain(strip);
    }

    function removeDeviceFromStrip(trackId: string, deviceId: string): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        const dn = strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        for (const n of dn.nodes) {
            n.disconnect();
        }
        strip.deviceNodes = strip.deviceNodes.filter((d) => d.deviceId !== deviceId);
        pendingFaustParams.delete(deviceId);
        rebuildStripChain(strip);
    }

    function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        const dn = strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }

        if (dn.type.startsWith('faust-')) {
            if (dn.nodes.length === 1 && dn.nodes[0] instanceof GainNode) {
                let map = pendingFaustParams.get(deviceId);
                if (!map) {
                    map = new Map();
                    pendingFaustParams.set(deviceId, map);
                }
                map.set(paramId, value);
                return;
            }

            const worklet = dn.nodes[0] as AudioWorkletNode;
            const param = worklet.parameters.get(paramId);
            if (param) param.setTargetAtTime(value, context.currentTime, 0.01);
            return;
        }

        switch (dn.type) {
            case 'builtin-eq': {
                const [low, mid, high] = dn.nodes as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
                if (paramId === 'eq-low-gain') {
                    low.gain.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-low-freq') {
                    low.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-mid-gain') {
                    mid.gain.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-mid-freq') {
                    mid.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-mid-q') {
                    mid.Q.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-high-gain') {
                    high.gain.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'eq-high-freq') {
                    high.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-compressor': {
                const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
                if (paramId === 'comp-threshold') {
                    comp.threshold.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'comp-ratio') {
                    comp.ratio.setTargetAtTime(Math.max(1, value), context.currentTime, 0.01);
                } else if (paramId === 'comp-attack') {
                    comp.attack.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                } else if (paramId === 'comp-release') {
                    comp.release.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                } else if (paramId === 'comp-knee') {
                    comp.knee.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'comp-makeup') {
                    makeup.gain.setTargetAtTime(10 ** (value / 20), context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-reverb': {
                const wet = dn.nodes[2] as GainNode;
                const dry = dn.nodes[1] as GainNode;
                if (paramId === 'rev-mix') {
                    wet.gain.setTargetAtTime(value, context.currentTime, 0.01);
                    dry.gain.setTargetAtTime(1 - value, context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-delay': {
                const delay = dn.nodes[3] as DelayNode;
                const fb = dn.nodes[4] as GainNode;
                const dryD = dn.nodes[1] as GainNode;
                const wetD = dn.nodes[2] as GainNode;
                if (paramId === 'delay-time') {
                    delay.delayTime.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                } else if (paramId === 'delay-feedback') {
                    fb.gain.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'delay-mix') {
                    wetD.gain.setTargetAtTime(value, context.currentTime, 0.01);
                    dryD.gain.setTargetAtTime(1 - value, context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-gain': {
                const g = dn.nodes[0] as GainNode;
                if (paramId === 'gain-level') {
                    g.gain.setTargetAtTime(10 ** (value / 20), context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-sidechain-compressor': {
                const worklet = dn.nodes[0] as AudioWorkletNode;
                const param = worklet.parameters.get(paramId.replace('sc-comp-', ''));
                if (param) {
                    if (paramId === 'sc-comp-attack' || paramId === 'sc-comp-release') {
                        param.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                    } else {
                        param.setTargetAtTime(value, context.currentTime, 0.01);
                    }
                }
                break;
            }
            case 'builtin-chorus': {
                const dryC = dn.nodes[1] as GainNode;
                const wetC = dn.nodes[2] as GainNode;
                const delayC = dn.nodes[3] as DelayNode;
                const lfoC = dn.nodes[4] as OscillatorNode;
                const lfoGainC = dn.nodes[5] as GainNode;
                if (paramId === 'chorus-rate') {
                    lfoC.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'chorus-depth') {
                    lfoGainC.gain.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                    delayC.delayTime.setTargetAtTime(Math.max(0.001, value / 1000), context.currentTime, 0.01);
                } else if (paramId === 'chorus-mix') {
                    wetC.gain.setTargetAtTime(value, context.currentTime, 0.01);
                    dryC.gain.setTargetAtTime(1 - value, context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-phaser': {
                const filters = dn.nodes.slice(1, 5) as BiquadFilterNode[];
                const lfoP = dn.nodes[5] as OscillatorNode;
                const lfoGainP = dn.nodes[6] as GainNode;
                const feedbackP = dn.nodes[7] as GainNode;
                const dryP = dn.nodes[8] as GainNode;
                const wetP = dn.nodes[9] as GainNode;
                if (paramId === 'phaser-rate') {
                    lfoP.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'phaser-depth') {
                    lfoGainP.gain.setTargetAtTime(value * 1000, context.currentTime, 0.01);
                    const wetVal = value * 0.5 + 0.25;
                    wetP.gain.setTargetAtTime(Math.min(1, wetVal), context.currentTime, 0.01);
                    dryP.gain.setTargetAtTime(1 - Math.min(1, wetVal), context.currentTime, 0.01);
                } else if (paramId === 'phaser-feedback') {
                    feedbackP.gain.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'phaser-stages') {
                    for (const f of filters) {
                        f.Q.setTargetAtTime(value > 6 ? 1 : 0.5, context.currentTime, 0.01);
                    }
                }
                break;
            }
            case 'builtin-distortion': {
                const dryD = dn.nodes[1] as GainNode;
                const wetD = dn.nodes[2] as GainNode;
                const shaperD = dn.nodes[3] as WaveShaperNode;
                const toneD = dn.nodes[4] as BiquadFilterNode;
                if (paramId === 'dist-drive') {
                    shaperD.curve = makeDistortionCurve(value);
                } else if (paramId === 'dist-tone') {
                    toneD.frequency.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'dist-mix') {
                    wetD.gain.setTargetAtTime(value, context.currentTime, 0.01);
                    dryD.gain.setTargetAtTime(1 - value, context.currentTime, 0.01);
                }
                break;
            }
            case 'builtin-limiter': {
                const compL = dn.nodes[0] as DynamicsCompressorNode;
                const ceilingL = dn.nodes[1] as GainNode;
                if (paramId === 'lim-threshold') {
                    compL.threshold.setTargetAtTime(value, context.currentTime, 0.01);
                } else if (paramId === 'lim-release') {
                    compL.release.setTargetAtTime(value / 1000, context.currentTime, 0.01);
                } else if (paramId === 'lim-ceiling') {
                    ceilingL.gain.setTargetAtTime(10 ** (value / 20), context.currentTime, 0.01);
                }
                break;
            }
            default: {
                // Native DSP device — forward param via MessagePort
                if (dn.type.startsWith('native-') && dn.nativeDspControls) {
                    dn.nativeDspControls.setParam(paramId, value);
                } else if (DEVICE_FACTORIES[dn.type]) {
                    // Factory-created web device — delegate to shared applyParams
                    applyParams(dn, dn.type, { [paramId]: value });
                }
                break;
            }
        }
    }

    function updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        const dn = strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        if (dn.nativeDspControls) {
            dn.nativeDspControls.setBypass(bypassed);
        } else {
            // Web audio bypass: disconnect from chain or reconnect
            // We rebuild the chain which naturally skips bypassed devices
            // Store bypass state on the node for rebuildStripChain to check
            (dn as any)._bypassed = bypassed;
            rebuildStripChain(strip);
        }
    }

    function ensureBusStrip(busId: string): BusStrip {
        const existing = busStrips.get(busId);
        if (existing) {
            return existing;
        }

        const gainNode = context.createGain();
        gainNode.gain.value = 1;

        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.8;

        gainNode.connect(analyserNode);
        analyserNode.connect(masterGainNode);

        const strip: BusStrip = {
            busId,
            gainNode,
            analyserNode,
            meterBuffer: new Float32Array(analyserNode.frequencyBinCount),
        };
        busStrips.set(busId, strip);
        return strip;
    }

    function removeBusStrip(busId: string): void {
        const strip = busStrips.get(busId);
        if (!strip) {
            return;
        }
        for (const [key, send] of sendNodes) {
            if (send.busId === busId) {
                send.gainNode.disconnect();
                sendNodes.delete(key);
            }
        }
        strip.gainNode.disconnect();
        strip.analyserNode.disconnect();
        busStrips.delete(busId);
    }

    async function waitForDevices(): Promise<void> {
        while (pendingDevicePromises.size > 0) {
            await Promise.all(Array.from(pendingDevicePromises));
        }
    }

    function setBusGain(busId: string, gain: number): void {
        const strip = busStrips.get(busId);
        if (!strip) {
            return;
        }
        strip.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(2, gain)), context.currentTime, 0.01);
    }

    const sendKey = (src: string, bus: string) => `${src}→${bus}`;

    const tapNodeForSend = (strip: TrackChannelStrip, preFader: boolean): AudioNode =>
        preFader ? strip.preFaderTap : strip.analyserNode;

    function reconnectSendsForTrack(strip: TrackChannelStrip): void {
        for (const [, send] of sendNodes) {
            if (send.sourceTrackId !== strip.trackId) {
                continue;
            }
            try {
                send.gainNode.disconnect();
            } catch {
                /* already disconnected */
            }
            const tap = tapNodeForSend(strip, send.preFader);
            tap.connect(send.gainNode);
            const busStrip = busStrips.get(send.busId);
            if (busStrip) {
                send.gainNode.connect(busStrip.gainNode);
            }
        }
    }

    function setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
        const trackStrip = trackStrips.get(sourceTrackId);
        if (!trackStrip) {
            return;
        }
        const busStrip = ensureBusStrip(busId);
        const key = sendKey(sourceTrackId, busId);

        const existing = sendNodes.get(key);
        if (existing) {
            existing.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), context.currentTime, 0.01);
            if (existing.preFader !== preFader) {
                try {
                    existing.gainNode.disconnect();
                } catch {
                    /* already disconnected */
                }
                const tap = tapNodeForSend(trackStrip, preFader);
                tap.connect(existing.gainNode);
                existing.gainNode.connect(busStrip.gainNode);
                existing.preFader = preFader;
            }
            return;
        }

        const sendGain = context.createGain();
        sendGain.gain.value = level;
        const tap = tapNodeForSend(trackStrip, preFader);
        tap.connect(sendGain);
        sendGain.connect(busStrip.gainNode);

        sendNodes.set(key, { sourceTrackId, busId, gainNode: sendGain, preFader });
    }

    function removeSend(sourceTrackId: string, busId: string): void {
        const key = sendKey(sourceTrackId, busId);
        const send = sendNodes.get(key);
        if (!send) {
            return;
        }
        send.gainNode.disconnect();
        sendNodes.delete(key);
    }

    function setTrackOutput(trackId: string, outputId: string): void {
        const strip = trackStrips.get(trackId);
        if (!strip) {
            return;
        }
        strip.outputId = outputId;
        strip.analyserNode.disconnect();

        if (outputId === 'hw_out') {
            strip.analyserNode.connect(masterGainNode);
        } else {
            const targetStrip = busStrips.get(outputId) || trackStrips.get(outputId);
            if (targetStrip) {
                strip.analyserNode.connect(targetStrip.gainNode);
            } else {
                // Fallback (e.g. Master track strip hasn't been created yet)
                strip.analyserNode.connect(masterGainNode);
            }
        }
    }

    function getBusPeakLevel(busId: string): number {
        const strip = busStrips.get(busId);
        if (!strip) {
            return 0;
        }
        const data = strip.meterBuffer;
        if (data) {
            strip.analyserNode.getFloatTimeDomainData(data as any);
        }
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
        return peak;
    }

    const sidechainKey = (sourceTrackId: string, targetDeviceId: string) => `${sourceTrackId}→${targetDeviceId}`;

    function wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        const sourceStrip = trackStrips.get(sourceTrackId);
        const targetStrip = trackStrips.get(targetTrackId);
        if (!sourceStrip || !targetStrip) {
            return;
        }

        const deviceNode = targetStrip.deviceNodes.find((d) => d.deviceId === targetDeviceId);
        if (!deviceNode || deviceNode.type !== 'builtin-sidechain-compressor') {
            return;
        }

        const key = sidechainKey(sourceTrackId, targetDeviceId);
        const existing = sidechainConnections.get(key);
        if (existing) {
            return;
        }

        const scGain = context.createGain();
        scGain.gain.value = 1;
        sourceStrip.analyserNode.connect(scGain);
        scGain.connect(deviceNode.inputNode, 0, 1);

        sidechainConnections.set(key, scGain);
    }

    function unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
        const key = sidechainKey(sourceTrackId, targetDeviceId);
        const scGain = sidechainConnections.get(key);
        if (!scGain) {
            return;
        }

        scGain.disconnect();
        sidechainConnections.delete(key);
    }

    function dispose(): void {
        stopAllScheduled();
        for (const [, scGain] of sidechainConnections) {
            scGain.disconnect();
        }
        sidechainConnections.clear();
        for (const [, send] of sendNodes) {
            send.gainNode.disconnect();
        }
        sendNodes.clear();
        for (const [id] of busStrips) {
            removeBusStrip(id);
        }
        for (const [id] of trackStrips) {
            removeTrackStrip(id);
        }
        masterGainNode.disconnect();
        masterAnalyser.disconnect();
        void context.close();
    }

    return {
        context,
        masterGainNode,
        masterAnalyser,
        initialize,
        resume,
        suspend,
        setMasterGain,
        getMasterGain,
        getState,
        dispose,
        ensureTrackStrip,
        removeTrackStrip,
        getTrackStrip,
        setTrackGain,
        setTrackPan,
        setTrackMute,
        getTrackPeakLevel,
        getMasterPeakLevel,
        getBusPeakLevel,
        addDeviceToStrip,
        removeDeviceFromStrip,
        updateDeviceParam,
        updateDeviceBypass,
        ensureBusStrip,
        removeBusStrip,
        setBusGain,
        setSend,
        removeSend,
        setTrackOutput,
        scheduleOscillator,
        scheduleClick,
        stopAllScheduled,
        wireSidechainRoute,
        unwireSidechainRoute,
        waitForDevices,
    };
}

/** Singleton audio engine instance. */
export const audioEngine = createWebAudioEngine();
