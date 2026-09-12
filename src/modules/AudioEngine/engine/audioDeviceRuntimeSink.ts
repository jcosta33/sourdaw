import { type DeviceStateChunk } from '#/modules/Arrangement/stores';

import { type NativeSampleBankLease } from '../models/NativeSampleBank';

import { type BacteriaMeterData } from './BacteriaNode';
import { type CrustMeterData } from './CrustNode';
import { type DeviceContentLoadOutcome } from './deviceReadinessDiagnostics';
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
};

/**
 * The two Proof gestures that have no device-parameter spelling, and so are the
 * whole of what the worklet is reached for directly.
 *
 * A live parameter write is deliberately absent: Proof sends every one of those
 * through `updateDeviceParam`, so a natively carried body hears it too.
 */
type ProofRuntimeBridge = {
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
    }) => Promise<DeviceContentLoadOutcome>;
    unregisterLevainDevice: (deviceId: string) => void;
    setLevainEngineReady: (input: { deviceId: string; isReady: boolean }) => void;
    setFermenterTelemetry: (deviceId: string, telemetry: FermenterTelemetry) => void;
    updateGlutenMeters: (deviceId: string, meters: GlutenMeterData) => void;
    deleteGlutenMeters: (deviceId: string) => void;
    updateCrustMeters: (deviceId: string, meters: CrustMeterData) => void;
    deleteCrustMeters: (deviceId: string) => void;
    updateBacteriaMeters: (deviceId: string, meters: BacteriaMeterData) => void;
    updateGrinderTelemetry: (deviceId: string, telemetry: GrinderMeterData) => void;
    registerProofDevice: (input: { deviceId: string; bridge: ProofRuntimeBridge }) => void;
    unregisterProofDevice: (deviceId: string) => void;
    syncProofPatch: (deviceId: string) => void;
    updateProofMeters: (deviceId: string, meters: ProofMeterData) => void;
    clearProofMeters: (deviceId: string) => void;
    /**
     * The Web Audio twin's reading, posted by the Tuner worklet through the
     * WASM device registry.
     *
     * One of two producers for one panel. The composition root arbitrates:
     * for a device whose strip the native session is carrying and sounding,
     * this publish is dropped and [updateNativeTunerTelemetry] below is the
     * one that lands — the web graph is still running behind the shadowed
     * carrier and its analyser still posts, but what it heard is not what the
     * musician is hearing. Arbitration lives at the root rather than here
     * because neither producer can see the other.
     */
    updateTunerTelemetry: (deviceId: string, telemetry: ScoringTelemetry) => void;
    /**
     * The native body's reading, carried on the transport poll
     * (`EngineTransportPosition.tunerTelemetry`) and published by
     * `publishNativeTunerTelemetry` for the devices that session actually
     * sounds.
     *
     * Separate from [updateTunerTelemetry] so the root can arbitrate at all:
     * one entry point would leave the two carriers overwriting each other at
     * poll and post rate, and the panel would flicker between two analysers'
     * answers for the same string.
     */
    updateNativeTunerTelemetry: (deviceId: string, telemetry: ScoringTelemetry) => void;
    /**
     * Perform the engine setup an instrument needs before it can render, and
     * resolve only once it can.
     *
     * The offline render builds its nodes through a different registry than live
     * playback, so none of the per-device setup the live descriptors perform ever
     * ran for an export. A bare Levain engine has no sample zones and therefore
     * renders silence. This is the seam where the offline path asks for its
     * context-local bank setup and — unlike live registration, which is
     * deliberately fire-and-forget — waits for the commit acknowledgement.
     *
     * The offline device chain calls this for every worklet-backed device it
     * builds. Deciding which device types have anything to prepare belongs to the
     * composition root; a type with no setup resolves immediately.
     */
    prepareOfflineInstrument: (input: {
        deviceId: string;
        deviceType: string;
        /** Opaque snapshot state; only the owning device module may decode it. */
        deviceState?: unknown;
        port: MessagePort;
        /** Aborts the setup when the export is cancelled or outruns its deadline. */
        signal?: AbortSignal;
    }) => Promise<void>;
    /**
     * A device's `deviceState` as the numeric record its native body would need
     * merged into `parameterValues`, or `null` when the type carries no such
     * projection.
     *
     * `Device.deviceState` never crosses the wire to the native engine
     * (`serializeAudioGraphCommand.ts` drops it) — it is opaque project-owned
     * state only the owning module can decode, the same reason
     * `prepareOfflineInstrument` exists for the offline worklet path. This is
     * the live/offline-via-native mirror of that seam:
     * `projectDeviceForNativeBody` calls it, pure and synchronous, to fold a
     * device's kit into the record a native body actually receives. A type with
     * nothing beyond `parameterValues` — most native built-ins — answers `null`.
     */
    projectNativeDeviceState: (input: {
        deviceType: string;
        deviceState: DeviceStateChunk | undefined;
    }) => Readonly<Record<string, number>> | null;
    /**
     * The native sample bank a device sounds, as the bank store keys it, or
     * `null` when the type sounds no bank.
     *
     * A sampler is the one built-in whose body cannot be built from its
     * `parameterValues` at all: `map_device` answers `Err` for a Levain device
     * that names no committed bank rather than splicing a mute sampler onto the
     * strip, and on an audible strip that refuses the batch whole
     * (`crates/sourdaw-native/src/commands/graph.rs`). So the key has to reach
     * the wire beside the record, and only the owning module can read which
     * instrument a device's opaque `deviceState` selects — the same reason
     * `projectNativeDeviceState` exists, answered from the same composition
     * root.
     */
    nativeSampleBankKey: (input: { deviceType: string; deviceState: DeviceStateChunk | undefined }) => string | null;
    /**
     * The engine's own name for one project-side parameter id of a built-in
     * body, or `null` for an id that body does not address.
     *
     * Most built-ins state their vocabulary in `nativeBuiltinBodies`' own table
     * or in a mapper this module holds. A device module whose panel writes to
     * the engine *directly* cannot be read from there: it imports this module
     * to deliver those writes, so this module importing it back would close a
     * cycle. Answered from the composition root instead, which may see both.
     */
    nativeBuiltinParameterName: (input: { deviceType: string; paramId: string }) => string | null;
    /**
     * Decode the bank under `bankKey` and hold it, or answer `null` for a key
     * no module claims.
     *
     * The other half of [nativeSampleBankKey]: the producer names a bank on the
     * wire, and the backend stages that bank's material before the batch that
     * names it — the ordering `register_timeline_sample` already keeps for clip
     * material, and for the same reason. The lease is the caller's to release
     * once the bytes have crossed; the bank's life on the native side is ended
     * by `release_levain_bank` instead.
     */
    acquireNativeSampleBank: (bankKey: string) => Promise<NativeSampleBankLease | null>;
    /**
     * Give a *live* Crumbs worklet the sample the device is set to play.
     *
     * A wasm Crumbs instance starts with an empty pool, so without this it
     * renders silence no matter what the project says. The composition root
     * routes this and the `builtin-crumbs` arm of `prepareOfflineInstrument` to
     * the same use case on purpose: the live and offline registries building
     * two differently-configured engines is the failure this device is being
     * dug out of, and one shared call is what stops it recurring.
     *
     * The node may join the graph before its sample commits, but the descriptor
     * awaits this outcome so readiness never claims the device is playable
     * early. The ownership signal cancels that wait on removal, timeout, or
     * teardown. The offline path also awaits; see `prepareOfflineInstrument`.
     */
    prepareCrumbsDevice: (input: {
        deviceId: string;
        port: MessagePort;
        signal?: AbortSignal;
    }) => Promise<DeviceContentLoadOutcome>;
};

const defaultSink: AudioDeviceRuntimeSink = {
    emitDeviceLoaded: () => {},
    emitDeviceRemoved: () => {},
    registerLevainDevice: () => Promise.resolve('failed'),
    unregisterLevainDevice: () => {},
    setLevainEngineReady: () => {},
    setFermenterTelemetry: () => {},
    updateGlutenMeters: () => {},
    deleteGlutenMeters: () => {},
    updateCrustMeters: () => {},
    deleteCrustMeters: () => {},
    updateBacteriaMeters: () => {},
    updateGrinderTelemetry: () => {},
    registerProofDevice: () => {},
    unregisterProofDevice: () => {},
    syncProofPatch: () => {},
    updateProofMeters: () => {},
    clearProofMeters: () => {},
    updateTunerTelemetry: () => {},
    updateNativeTunerTelemetry: () => {},
    prepareOfflineInstrument: async () => {},
    projectNativeDeviceState: () => null,
    nativeSampleBankKey: () => null,
    nativeBuiltinParameterName: () => null,
    acquireNativeSampleBank: () => Promise.resolve(null),
    prepareCrumbsDevice: () => Promise.resolve('failed'),
};

let runtimeSink = defaultSink;

export function setAudioDeviceRuntimeSink(sink: Partial<AudioDeviceRuntimeSink>): void {
    runtimeSink = { ...defaultSink, ...sink };
}

export function getAudioDeviceRuntimeSink(): AudioDeviceRuntimeSink {
    return runtimeSink;
}
