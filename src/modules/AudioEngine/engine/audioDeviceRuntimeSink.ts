import { type DeviceContentLoadOutcome } from '../services/deviceReadinessDiagnostics';

import { type BacteriaMeterData } from './BacteriaNode';
import { type FermenterNodeResult } from './FermenterNode';
import { type GlutenMeterData } from './GlutenNode';
import { type GrinderMeterData } from './GrinderNode';
import { type LevainNodeResult } from './LevainNode';
import { type ProofMeterData, type ProofNodeResult } from './ProofNode';
import { type ScoringNodeResult } from './ScoringNode';

type DeviceLifecyclePayload = {
    deviceId: string;
    deviceType: string;
};

type LevainRuntimeDevice = {
    setParam: LevainNodeResult['setParam'];
    handleCc: LevainNodeResult['handleCc'];
    setInstrument: LevainNodeResult['setInstrument'];
};

type ProofRuntimeBridge = {
    setParam: ProofNodeResult['setParam'];
    reorderModules: ProofNodeResult['reorderModules'];
    resetIntegrated: ProofNodeResult['resetIntegrated'];
};

type FermenterTelemetry = Parameters<FermenterNodeResult['onTelemetry']>[0] extends (data: infer Telemetry) => void
    ? Telemetry
    : never;

type ScoringTelemetry = Parameters<ScoringNodeResult['onTelemetry']>[0] extends (data: infer Telemetry) => void
    ? Telemetry
    : never;

export type AudioDeviceRuntimeSink = {
    emitDeviceLoaded: (payload: DeviceLifecyclePayload) => void;
    emitDeviceRemoved: (payload: DeviceLifecyclePayload) => void;
    registerLevainDevice: (input: {
        deviceId: string;
        device: LevainRuntimeDevice;
        port?: MessagePort;
        onContentLoadSettled?: (outcome: DeviceContentLoadOutcome) => void;
    }) => void;
    unregisterLevainDevice: (deviceId: string) => void;
    setLevainEngineReady: (input: { deviceId: string; isReady: boolean }) => void;
    setFermenterTelemetry: (deviceId: string, telemetry: FermenterTelemetry) => void;
    updateGlutenMeters: (deviceId: string, meters: GlutenMeterData) => void;
    deleteGlutenMeters: (deviceId: string) => void;
    updateBacteriaMeters: (deviceId: string, meters: BacteriaMeterData) => void;
    updateGrinderTelemetry: (deviceId: string, telemetry: GrinderMeterData) => void;
    registerProofDevice: (input: { deviceId: string; bridge: ProofRuntimeBridge }) => void;
    unregisterProofDevice: (deviceId: string) => void;
    syncProofPatch: (deviceId: string) => void;
    updateProofMeters: (deviceId: string, meters: ProofMeterData) => void;
    updateTunerTelemetry: (deviceId: string, telemetry: ScoringTelemetry) => void;
    /**
     * Perform the engine setup an instrument needs before it can render, and
     * resolve only once it can.
     *
     * The offline render builds its nodes through a different registry than live
     * playback, so none of the per-device setup the live descriptors perform ever
     * ran for an export. Levain therefore rendered digital silence: no zones, and
     * a fallback tone that only `clear_zones()` arms — and, once that was fixed,
     * still rendered as an unconfigured engine, because `setInstrument` is what
     * configures the realism layer and it was never posted either. This is the
     * seam where the offline path asks for that setup, and — unlike the live
     * registration, which is deliberately fire-and-forget — waits for it.
     *
     * The offline device chain calls this for every worklet-backed device it
     * builds. Deciding which device types have anything to prepare belongs to the
     * composition root; a type with no setup resolves immediately.
     */
    prepareOfflineInstrument: (input: {
        deviceId: string;
        deviceType: string;
        port: MessagePort;
        /** Aborts the setup when the export is cancelled or outruns its deadline. */
        signal?: AbortSignal;
    }) => Promise<void>;
};

const defaultSink: AudioDeviceRuntimeSink = {
    emitDeviceLoaded: () => {},
    emitDeviceRemoved: () => {},
    registerLevainDevice: () => {},
    unregisterLevainDevice: () => {},
    setLevainEngineReady: () => {},
    setFermenterTelemetry: () => {},
    updateGlutenMeters: () => {},
    deleteGlutenMeters: () => {},
    updateBacteriaMeters: () => {},
    updateGrinderTelemetry: () => {},
    registerProofDevice: () => {},
    unregisterProofDevice: () => {},
    syncProofPatch: () => {},
    updateProofMeters: () => {},
    updateTunerTelemetry: () => {},
    prepareOfflineInstrument: async () => {},
};

let runtimeSink = defaultSink;

export function setAudioDeviceRuntimeSink(sink: Partial<AudioDeviceRuntimeSink>): void {
    runtimeSink = { ...defaultSink, ...sink };
}

export function getAudioDeviceRuntimeSink(): AudioDeviceRuntimeSink {
    return runtimeSink;
}
