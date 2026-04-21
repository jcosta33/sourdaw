import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { BusNode } from '../engine/BusNode';
import { TrackNode } from '../engine/TrackNode';
import meteringProcessorUrl from '../services/meteringProcessor.ts?worker&url';
import recordingProcessorUrl from '../services/recordingProcessor.ts?worker&url';

import type { AudioEngine, AudioEngineState, TrackChannelStrip, BusStrip, SendNode } from '../models/AudioEngineState';

class AudioEngineImpl implements AudioEngine {
    public context!: AudioContext;
    public masterGainNode!: GainNode;
    public masterAnalyser!: AnalyserNode;
    public masterMeterNode!: AudioWorkletNode;

    private trackNodes = new Map<string, TrackNode>();
    private busNodes = new Map<string, BusNode>();
    private sendNodes = new Map<string, SendNode>();
    private sidechainConnections = new Map<string, GainNode>();
    private scheduledNodes: AudioScheduledSourceNode[] = [];
    private masterMeterBuffer!: Float32Array;
    private pendingDevicePromises = new Set<Promise<unknown>>();
    private workletReady = false;
    private fallbackMode = false;
    private transportSAB: SharedArrayBuffer;
    private transportView: Float64Array;
    private initPromise: Promise<void> | null = null;

    constructor(providedContext?: AudioContext) {
        // Transport SAB Layout (Float64Array):
        // 0: currentBeat, 1: tempo, 2: sampleRate, 3: loopStart, 4: loopEnd, 5: isPlaying, 6: isLooping
        this.transportSAB = new SharedArrayBuffer(64);
        this.transportView = new Float64Array(this.transportSAB);

        try {
            this.context = providedContext ?? new AudioContext({ latencyHint: 'interactive' });
            this.masterGainNode = this.context.createGain();
            this.masterGainNode.gain.value = 0.8;

            this.masterAnalyser = this.context.createAnalyser();
            this.masterAnalyser.fftSize = 256;
            this.masterAnalyser.smoothingTimeConstant = 0.8;

            this.masterGainNode.connect(this.masterAnalyser);
            this.masterAnalyser.connect(this.context.destination);
            this.masterMeterBuffer = new Float32Array(this.masterAnalyser.frequencyBinCount);
        } catch (error) {
            logger.warn(`Failed to create AudioContext: ${error}`);
            notifyUser(
                'Audio engine failed to initialize — audio playback is disabled. Try reloading the page.',
                'error'
            );
            this.fallbackMode = true;
            this.setupNoopContext();
        }
    }

    private setupNoopContext() {
        this.context = new OfflineAudioContext(2, 1, 44100) as unknown as AudioContext;
        this.masterGainNode = this.context.createGain();
        this.masterGainNode.gain.value = 0;
        this.masterMeterNode = {
            connect: () => {},
            disconnect: () => {},
            port: { postMessage: () => {} },
        } as unknown as AudioWorkletNode; // Mock node for noop/offline fallback
        this.masterAnalyser = this.context.createAnalyser();
        this.masterMeterBuffer = new Float32Array(1);
    }

    public initialize(): Promise<void> {
        this.initPromise ??= this.fallbackMode ? Promise.resolve() : this.loadWorklets();
        return this.initPromise;
    }

    private async loadWorklets(): Promise<void> {
        await Promise.all([
            this.context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js'),
            this.context.audioWorklet.addModule('/audio/worklets/native-plugin-host-processor.js'),
            this.context.audioWorklet.addModule('/audio/worklets/native-plugin-bridge-processor.js'),
            this.context.audioWorklet.addModule(recordingProcessorUrl),
            this.context.audioWorklet.addModule(meteringProcessorUrl),
        ]);
        this.workletReady = true;
    }

    public async resume(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'suspended') {
                await this.context.resume();
            }
        } catch (error) {
            logger.warn(`AudioContext resume failed: ${error}`);
        }
    }

    public async suspend(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'running') {
                await this.context.suspend();
            }
        } catch (error) {
            logger.warn(`AudioContext suspend failed: ${error}`);
        }
    }

    public setMasterGain(value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.masterGainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.01);
    }

    public getMasterGain(): number {
        if (this.fallbackMode) {
            return 0;
        }
        return this.masterGainNode.gain.value;
    }

    public getState(): AudioEngineState {
        if (this.fallbackMode) {
            return {
                isReady: false,
                sampleRate: 44100,
                state: 'closed',
                masterGain: 0,
                currentTime: 0,
                baseLatency: 0,
            };
        }
        return {
            isReady: this.context.state === 'running' || this.workletReady,
            sampleRate: this.context.sampleRate,
            state: this.context.state,
            masterGain: this.masterGainNode.gain.value,
            currentTime: this.context.currentTime,
            baseLatency: this.context.baseLatency ?? 0,
        };
    }

    public ensureTrackStrip(trackId: string): TrackChannelStrip {
        let node = this.trackNodes.get(trackId);
        if (!node) {
            if (this.fallbackMode) {
                const sG = this.context.createGain();
                node = new TrackNode(trackId, {
                    context: this.context,
                    masterGainNode: sG,
                    getBusGainNode: () => undefined,
                    getTrackGainNode: () => undefined,
                    getSendsForTrack: () => [],
                    pendingDevicePromises: new Set(),
                });
            } else {
                node = new TrackNode(trackId, {
                    context: this.context,
                    masterGainNode: this.masterGainNode,
                    getBusGainNode: (id) => this.busNodes.get(id)?.strip.gainNode,
                    getTrackGainNode: (id) => this.trackNodes.get(id)?.strip.gainNode,
                    getSendsForTrack: (tId) =>
                        Array.from(this.sendNodes.values()).filter((s) => s.sourceTrackId === tId),
                    pendingDevicePromises: this.pendingDevicePromises,
                    transportSAB: this.transportSAB,
                });
            }
            this.trackNodes.set(trackId, node);
        }
        return node.strip;
    }

    public removeTrackStrip(trackId: string): void {
        const node = this.trackNodes.get(trackId);
        if (node) {
            node.dispose();
            this.trackNodes.delete(trackId);
        }
    }

    public getTrackStrip(trackId: string): TrackChannelStrip | undefined {
        return this.trackNodes.get(trackId)?.strip;
    }

    public setTrackGain(trackId: string, gain: number): void {
        this.trackNodes.get(trackId)?.setGain(gain);
    }

    public setTrackPan(trackId: string, pan: number): void {
        this.trackNodes.get(trackId)?.setPan(pan);
    }

    public setTrackMute(trackId: string, muted: boolean, _restoreGain?: number): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.setMute(muted);
    }

    public getTrackPeakLevel(trackId: string): number {
        return this.trackNodes.get(trackId)?.getPeakLevel() ?? 0;
    }

    public getMasterPeakLevel(): number {
        if (this.fallbackMode) {
            return 0;
        }
        const peak = this.masterMeterBuffer[0]!;
        this.masterMeterBuffer[0] = 0;
        return peak;
    }

    public ensureBusStrip(busId: string): BusStrip {
        let node = this.busNodes.get(busId);
        if (!node) {
            node = new BusNode(busId, this.context, this.masterGainNode);
            this.busNodes.set(busId, node);
        }
        return node.strip;
    }

    public removeBusStrip(busId: string): void {
        const node = this.busNodes.get(busId);
        if (!node) {
            return;
        }
        for (const [key, send] of this.sendNodes) {
            if (send.busId === busId) {
                send.gainNode.disconnect();
                this.sendNodes.delete(key);
            }
        }
        node.dispose();
        this.busNodes.delete(busId);
    }

    public setBusGain(busId: string, gain: number): void {
        this.busNodes.get(busId)?.setGain(gain);
    }

    public getBusPeakLevel(busId: string): number {
        return this.busNodes.get(busId)?.getPeakLevel() ?? 0;
    }

    public addDeviceToStrip(trackId: string, deviceId: string, deviceType: string, externalInstanceId?: string): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.addDevice(deviceId, deviceType, externalInstanceId);
    }

    public removeDeviceFromStrip(trackId: string, deviceId: string): void {
        this.trackNodes.get(trackId)?.removeDevice(deviceId);
    }

    public updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
        this.trackNodes.get(trackId)?.updateParam(deviceId, paramId, value);
    }

    public updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
        this.trackNodes.get(trackId)?.updatePatch(deviceId, patch);
    }

    public scheduleDeviceParam(trackId: string, deviceId: string, paramId: string, value: number, time: number): void {
        this.trackNodes.get(trackId)?.scheduleParam(deviceId, paramId, value, time);
    }

    public updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
        this.trackNodes.get(trackId)?.updateBypass(deviceId, bypassed);
    }

    public addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
        this.trackNodes.get(trackId)?.addMidiFx(fxId, fxType);
    }

    public removeMidiFxFromStrip(trackId: string, fxId: string): void {
        this.trackNodes.get(trackId)?.removeMidiFx(fxId);
    }

    public updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
        this.trackNodes.get(trackId)?.updateMidiFxParam(fxId, paramId, value);
    }

    public updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
        this.trackNodes.get(trackId)?.updateMidiFxBypass(fxId, bypassed);
    }

    public syncKneadState(trackId: string, clips: Record<string, any>): void {
        const trackNode = this.trackNodes.get(trackId);
        if (trackNode) {
            for (const dn of trackNode.strip.deviceNodes) {
                if (dn.kneadControls) {
                    dn.kneadControls.updateState(clips);
                }
            }
        }
    }

    public registerTuningTable(frequencies: number[]): void {
        if (this.fallbackMode) {
            return;
        }
        for (const trackNode of this.trackNodes.values()) {
            trackNode.registerTuningTable(frequencies);
        }
    }

    public setTransportInfo(
        beat: number,
        tempo: number,
        isPlaying: boolean,
        loopStart = 0,
        loopEnd = 0,
        isLooping = false
    ): void {
        const v = this.transportView;
        v[0] = beat;
        v[1] = tempo;
        v[2] = this.context.sampleRate;
        v[3] = loopStart;
        v[4] = loopEnd;
        v[5] = isPlaying ? 1 : 0;
        v[6] = isLooping ? 1 : 0;
    }

    public getTransportSAB(): SharedArrayBuffer {
        return this.transportSAB;
    }

    public setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
        if (this.fallbackMode) {
            return;
        }
        const trackNode = this.trackNodes.get(sourceTrackId);
        if (!trackNode) {
            return;
        }
        const busStrip = this.ensureBusStrip(busId);
        const key = `${sourceTrackId}→${busId}`;

        const existing = this.sendNodes.get(key);
        if (existing) {
            existing.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.context.currentTime, 0.01);
            if (existing.preFader !== preFader) {
                try {
                    existing.gainNode.disconnect();
                } catch {}
                const tap = preFader ? trackNode.strip.preFaderTap : trackNode.strip.analyserNode;
                tap.connect(existing.gainNode);
                existing.gainNode.connect(busStrip.gainNode);
                existing.preFader = preFader;
            }
            return;
        }

        const sendGain = this.context.createGain();
        sendGain.gain.value = level;
        const tap = preFader ? trackNode.strip.preFaderTap : trackNode.strip.analyserNode;
        tap.connect(sendGain);
        sendGain.connect(busStrip.gainNode);
        this.sendNodes.set(key, { sourceTrackId, busId, gainNode: sendGain, preFader });
    }

    public removeSend(sourceTrackId: string, busId: string): void {
        const key = `${sourceTrackId}→${busId}`;
        const send = this.sendNodes.get(key);
        if (send) {
            send.gainNode.disconnect();
            this.sendNodes.delete(key);
        }
    }

    public setTrackOutput(trackId: string, outputId: string): void {
        this.trackNodes.get(trackId)?.setOutput(outputId);
    }

    public async waitForDevices(timeoutMs = 10000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (this.pendingDevicePromises.size > 0) {
            if (Date.now() > deadline) {
                logger.warn(`[AudioEngine] Device loading timed out (${this.pendingDevicePromises.size} pending)`);
                this.pendingDevicePromises.clear();
                return;
            }
            await Promise.all(Array.from(this.pendingDevicePromises));
        }
    }

    public wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        if (this.fallbackMode) {
            return;
        }
        const sourceStrip = this.trackNodes.get(sourceTrackId)?.strip;
        const targetStrip = this.trackNodes.get(targetTrackId)?.strip;
        if (!sourceStrip || !targetStrip) {
            return;
        }

        const deviceNode = targetStrip.deviceNodes.find((d) => d.deviceId === targetDeviceId);
        if (!deviceNode || deviceNode.type !== 'builtin-sidechain-compressor') {
            return;
        }

        const key = `${sourceTrackId}→${targetDeviceId}`;
        if (this.sidechainConnections.has(key)) {
            return;
        }

        const scGain = this.context.createGain();
        scGain.gain.value = 1;
        sourceStrip.analyserNode.connect(scGain);
        scGain.connect(deviceNode.inputNode, 0, 1);
        this.sidechainConnections.set(key, scGain);
    }

    public unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
        const key = `${sourceTrackId}→${targetDeviceId}`;
        const scGain = this.sidechainConnections.get(key);
        if (scGain) {
            scGain.disconnect();
            this.sidechainConnections.delete(key);
        }
    }

    public scheduleOscillator(frequency: number, startTime: number, duration: number, gain = 0.3): void {
        if (this.fallbackMode) {
            return;
        }
        const osc = this.context.createOscillator();
        const env = this.context.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(gain, startTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(env);
        env.connect(this.masterGainNode);
        osc.start(startTime);
        osc.stop(startTime + duration);
        this.scheduledNodes.push(osc);
        osc.onended = () => {
            const idx = this.scheduledNodes.indexOf(osc);
            if (idx >= 0) {
                this.scheduledNodes.splice(idx, 1);
            }
            env.disconnect();
        };
    }

    public scheduleClick(time: number, accent: boolean, volume = 1): void {
        const freq = accent ? 1500 : 1000;
        const dur = accent ? 0.04 : 0.03;
        const baseVol = accent ? 0.4 : 0.25;
        this.scheduleOscillator(freq, time, dur, baseVol * volume);
    }

    public stopAllScheduled(): void {
        if (this.fallbackMode) {
            return;
        }
        const now = this.context.currentTime;
        for (const node of [...this.scheduledNodes]) {
            try {
                node.stop(now);
            } catch {}
        }
        this.scheduledNodes.length = 0;

        // Send all-notes-off to Fermenter devices (MIDI notes 0-127)
        for (const [, trackNode] of this.trackNodes) {
            for (const dn of trackNode.strip.deviceNodes) {
                if (dn.fermenterControls) {
                    for (let note = 0; note < 128; note++) {
                        dn.fermenterControls.noteOff(note);
                    }
                }
                if (dn.toasterControls) {
                    for (let pad = 0; pad < 16; pad++) {
                        dn.toasterControls.noteOff(pad);
                    }
                }
                if (dn.levainControls) {
                    // Levain has a realism-layer release burst per noteOff
                    // (bow-lift noise on strings). A 128-note fan-out would
                    // retrigger that burst 128 times and produce an audible
                    // \"ksshh\" on every stop. Route through the dedicated
                    // silent all-notes-off path instead — see
                    // .agents/bugs/levain-stop-hihat-and-constant-white-noise.md.
                    dn.levainControls.allNotesOff();
                }
            }
        }
    }

    public resetGraph(): void {
        // Tear down all per-project audio graph state (tracks, buses, sends,
        // sidechain routes) without closing the AudioContext, master nodes,
        // or already-loaded worklet modules. Used when switching projects.
        this.stopAllScheduled();
        for (const [, scGain] of this.sidechainConnections) {
            try {
                scGain.disconnect();
            } catch {}
        }
        this.sidechainConnections.clear();
        for (const [, send] of this.sendNodes) {
            try {
                send.gainNode.disconnect();
            } catch {}
        }
        this.sendNodes.clear();
        for (const [id] of this.busNodes) {
            this.removeBusStrip(id);
        }
        for (const [id] of this.trackNodes) {
            this.removeTrackStrip(id);
        }
        this.pendingDevicePromises.clear();
    }

    public dispose(): void {
        this.resetGraph();
        this.masterGainNode.disconnect();
        this.masterAnalyser.disconnect();
        void this.context.close();
    }
}

export function createAudioEngine(providedContext?: AudioContext): AudioEngine {
    return new AudioEngineImpl(providedContext);
}

export const audioEngine = createAudioEngine();
