/**
 * Registry of async WASM device descriptors.
 *
 * Each descriptor encapsulates the full async load sequence for one plugin
 * (loading bypass, pending-params queue, WASM init, swap-in, side effects).
 * TrackNode.addDevice() resolves the right descriptor and calls create(),
 * eliminating the 10 type-guard branches.
 */

import { type BuiltinDeviceNode } from '../models/AudioEngineState';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { EventBus } from '#/helpers/Event/EventBus';
import { AudioDeviceLoadedEvent } from '../events/AudioDeviceLoadedEvent';

import { isFermenterDevice, createFermenterNode, type FermenterNodeResult } from './FermenterNode';
import { isToasterDevice, createToasterNode, type ToasterNodeResult } from './ToasterNode';
import { isLevainDevice, createLevainNode, type LevainNodeResult } from './LevainNode';
import { isProofChamberDevice, createProofChamberNode, type ProofChamberNodeResult } from './ProofChamberNode';
import { isGlutenDevice, createGlutenNode, type GlutenNodeResult } from './GlutenNode';
import { isBacteriaDevice, createBacteriaNode, type BacteriaNodeResult } from './BacteriaNode';
import { isGrinderDevice, createGrinderNode, type GrinderNodeResult } from './GrinderNode';
import { isProofDevice, createProofNode, type ProofNodeResult } from './ProofNode';
import { isScoringDevice, createScoringNode, type ScoringNodeResult } from './ScoringNode';

import { updateTunerTelemetry } from '#/modules/Scoring/stores/scoringStore';
import { updateGlutenMeters } from '#/modules/Gluten/stores/glutenStore';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores/bacteriaStore';
import { updateGrinderMeters } from '#/modules/Grinder/stores/grinderStore';
import { updateProofMeters } from '#/modules/Proof/stores/proofStore';
import { registerProofDevice, syncFullPatch } from '#/modules/Proof/useCases/proofParamBridge';
import {
    registerLevainDevice,
    unregisterLevainDevice as _unregisterLevainDevice,
} from '#/modules/Levain/useCases/levainParamBridge';
import { setEngineReady } from '#/modules/Levain/stores/levainStore';

const logger = Container.getInstance().get(Logger);
const eventBus = Container.getInstance().get(EventBus);

// ── Types ────────────────────────────────────────────────────────────────────

export type WasmDeviceCreateDeps = {
    context: AudioContext;
    deviceId: string;
    deviceType: string;
    /** Called with the fully-loaded BuiltinDeviceNode — swap-in + rebuildChain happen here */
    onLoaded: (finalDn: BuiltinDeviceNode) => void;
};

export type WasmDeviceDescriptor = {
    matches(deviceType: string): boolean;
    create(deps: WasmDeviceCreateDeps): {
        placeholder: BuiltinDeviceNode;
        loadPromise: Promise<void>;
    };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadingBypassNode(context: AudioContext, deviceId: string, deviceType: string): BuiltinDeviceNode {
    const node = context.createGain();
    return { deviceId, type: deviceType, nodes: [node], inputNode: node, outputNode: node };
}

// ── Descriptors ──────────────────────────────────────────────────────────────

const fermenterDescriptor: WasmDeviceDescriptor = {
    matches: isFermenterDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.fermenterControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createFermenterNode(context)
            .then(async (result: FermenterNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    fermenterControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Fermenter failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const toasterDescriptor: WasmDeviceDescriptor = {
    matches: isToasterDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.toasterControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setPadParam: () => {},
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createToasterNode(context)
            .then(async (result: ToasterNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    toasterControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        setParam: result.setParam,
                        setPadParam: result.setPadParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                eventBus.emit(new AudioDeviceLoadedEvent({ deviceId, deviceType }));
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Toaster failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const levainDescriptor: WasmDeviceDescriptor = {
    matches: isLevainDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.levainControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            handleCc: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createLevainNode(context)
            .then(async (result: LevainNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    levainControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        handleCc: result.handleCc,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                registerLevainDevice({ setParam: result.setParam, handleCc: result.handleCc }, result.workletNode.port);
                setEngineReady(true);
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Levain failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const proofChamberDescriptor: WasmDeviceDescriptor = {
    matches: isProofChamberDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createProofChamberNode(context)
            .then(async (result: ProofChamberNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Dutch Oven failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const glutenDescriptor: WasmDeviceDescriptor = {
    matches: isGlutenDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createGlutenNode(context)
            .then(async (result: GlutenNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onMeterData((data) => {
                    updateGlutenMeters(
                        deviceId,
                        data.grDb,
                        data.inputDb,
                        data.outputDb,
                        data.crest,
                        data.phaseCorr,
                        data.latency
                    );
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Gluten failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const bacteriaDescriptor: WasmDeviceDescriptor = {
    matches: isBacteriaDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createBacteriaNode(context)
            .then(async (result: BacteriaNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onMeterData((data) => {
                    updateBacteriaMeters(deviceId, data.inputDb, data.outputDb, data.bandLevels, data.latency);
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Bacteria failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const grinderDescriptor: WasmDeviceDescriptor = {
    matches: isGrinderDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        let pendingBypass = false;
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: (bypassed) => {
                pendingBypass = bypassed;
            },
        };
        const loadPromise = createGrinderNode(context)
            .then(async (result: GrinderNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onMeterData((data) => {
                    updateGrinderMeters(
                        deviceId,
                        data.inputDb,
                        data.preampDb,
                        data.powerAmpDb,
                        data.outputDb,
                        data.gateOpen,
                        data.gateEnvelopeDb,
                        data.sagVoltage,
                        data.latency,
                        data.neuralCpuPercent,
                        data.neuralWarmupProgress
                    );
                });
                if (pendingBypass) {
                    result.setBypass(true);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Grinder failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const proofDescriptor: WasmDeviceDescriptor = {
    matches: isProofDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createProofNode(context)
            .then(async (result: ProofNodeResult) => {
                await result.ready;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onMeterData((data) => {
                    updateProofMeters(deviceId, data);
                });
                registerProofDevice(deviceId, {
                    setParam: result.setParam,
                    reorderModules: result.reorderModules,
                    resetIntegrated: result.resetIntegrated,
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                syncFullPatch(deviceId);
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Proof failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const scoringDescriptor: WasmDeviceDescriptor = {
    matches: isScoringDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = { setParam: () => {}, setBypass: () => {} };
        const loadPromise = createScoringNode(context)
            .then(async (result: ScoringNodeResult) => {
                await result.ready;
                result.onTelemetry((data) => {
                    updateTunerTelemetry(deviceId, {
                        frequency: data.frequency,
                        cents: data.cents,
                        confidence: data.confidence,
                        noteIndex: data.noteIndex,
                        octave: data.octave,
                        midiNote: data.midiNote,
                        noteName: data.noteName,
                        active: data.active,
                    });
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Scoring failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const WASM_DEVICE_DESCRIPTORS: WasmDeviceDescriptor[] = [
    fermenterDescriptor,
    toasterDescriptor,
    levainDescriptor,
    proofChamberDescriptor,
    glutenDescriptor,
    bacteriaDescriptor,
    grinderDescriptor,
    proofDescriptor,
    scoringDescriptor,
];

export function findWasmDescriptor(deviceType: string): WasmDeviceDescriptor | undefined {
    return WASM_DEVICE_DESCRIPTORS.find((d) => d.matches(deviceType));
}
