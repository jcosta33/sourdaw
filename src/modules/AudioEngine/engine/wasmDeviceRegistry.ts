/**
 * Registry of async WASM device descriptors.
 *
 * Each descriptor encapsulates the full async load sequence for one plugin
 * (loading bypass, pending-params queue, WASM init, swap-in, side effects).
 * TrackNode.addDevice() resolves the right descriptor and calls create(),
 * eliminating the 10 type-guard branches.
 */

import { type BuiltinDeviceNode } from '../models/AudioEngineState';
import { logger } from '#/infra/logger/appLogger';
import { eventBus } from '#/app/registerDependencies';

import { isFermenterDevice, createFermenterNode, type FermenterNodeResult } from './FermenterNode';
import { isToasterDevice, createToasterNode, type ToasterNodeResult } from './ToasterNode';
import { isLevainDevice, createLevainNode, type LevainNodeResult } from './LevainNode';
import { isProofChamberDevice, createProofChamberNode, type ProofChamberNodeResult } from './ProofChamberNode';
import { isGlutenDevice, createGlutenNode, type GlutenNodeResult } from './GlutenNode';
import { isBacteriaDevice, createBacteriaNode, type BacteriaNodeResult } from './BacteriaNode';
import { isGrinderDevice, createGrinderNode, type GrinderNodeResult } from './GrinderNode';
import { isProofDevice, createProofNode, type ProofNodeResult } from './ProofNode';
import { isScoringDevice, createScoringNode, type ScoringNodeResult } from './ScoringNode';
import { isGrandBouleDevice, createGrandBouleNode, type GrandBouleNodeResult } from './GrandBouleNode';

import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { updateGlutenMeters } from '#/modules/Gluten/stores';
import { updateGrinderMeters } from '#/modules/Grinder/stores';
import { registerLevainDevice, unregisterLevainDevice as _unregisterLevainDevice } from '#/modules/Levain/useCases';
import { setEngineReady } from '#/modules/Levain/stores';
import { registerProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { updateProofMeters } from '#/modules/Proof/stores';
import { updateTunerTelemetry } from '#/modules/Scoring/stores';
import { createFaustDeviceNode } from '../useCases/deviceResolvers/createFaustDeviceNode';
import { isFaustModule } from '#/modules/Plugin/useCases';

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
                result.onTelemetry((data) => {
                    setFermenterTelemetry(deviceId, data.peakL, data.peakR, data.scopeBuffer);
                });
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
                eventBus.emit('audioDevice.loaded', { deviceId, deviceType });
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
            allNotesOff: () => {},
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
                        allNotesOff: result.allNotesOff,
                        handleCc: result.handleCc,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                registerLevainDevice(
                    {
                        setParam: result.setParam,
                        handleCc: result.handleCc,
                        setInstrument: result.setInstrument,
                    },
                    result.workletNode.port,
                );
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
                    updateGlutenMeters(deviceId, {
                        grDb: data.grDb,
                        inputDb: data.inputDb,
                        outputDb: data.outputDb,
                        crest: data.crest,
                        phaseCorr: data.phaseCorr,
                        latency: data.latency,
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
                    updateGrinderMeters(deviceId, {
                        inputDb: data.inputDb,
                        preampDb: data.preampDb,
                        powerAmpDb: data.powerAmpDb,
                        outputDb: data.outputDb,
                        gateOpen: data.gateOpen,
                        gateEnvelopeDb: data.gateEnvelopeDb,
                        sagVoltage: data.sagVoltage,
                        latency: data.latency,
                        neuralCpuPercent: data.neuralCpuPercent,
                        neuralWarmupProgress: data.neuralWarmupProgress,
                    });
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

const grandBouleDescriptor: WasmDeviceDescriptor = {
    matches: isGrandBouleDevice,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.grandBouleControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setSustain: () => {},
            setUnaCorda: () => {},
            setSostenuto: () => {},
            noteOnMidi2: () => {},
            setTemperament: () => {},
            loadAttackClip: () => {},
            allNotesOff: () => {},
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createGrandBouleNode(context)
            .then(async (result: GrandBouleNodeResult) => {
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
                    grandBouleControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        setParam: result.setParam,
                        setSustain: result.setSustain,
                        setUnaCorda: result.setUnaCorda,
                        setSostenuto: result.setSostenuto,
                        noteOnMidi2: result.noteOnMidi2,
                        setTemperament: result.setTemperament,
                        loadAttackClip: result.loadAttackClip,
                        allNotesOff: result.allNotesOff,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                eventBus.emit('audioDevice.loaded', { deviceId, deviceType });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Grand Boule failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

const faustDescriptor: WasmDeviceDescriptor = {
    matches: isFaustModule,
    create({ context, deviceId, deviceType, onLoaded }) {
        const pendingParams: Array<{ name: string; value: number; time?: number }> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.wamControls = {
            setParam: (name, value) => pendingParams.push({ name, value }),
            scheduleParam: (name, value, time) => pendingParams.push({ name, value, time }),
            destroy: () => {},
        };
        const loadPromise = createFaustDeviceNode(context, deviceType)
            .then((result) => {
                if (!result) return;
                const controls = result.wamControls;
                for (const { name, value, time } of pendingParams) {
                    if (time !== undefined) {
                        controls?.scheduleParam(name, value, time);
                    } else {
                        controls?.setParam(name, value);
                    }
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: result.nodes,
                    inputNode: result.inputNode,
                    outputNode: result.outputNode,
                    wamControls: controls,
                });
                eventBus.emit('audioDevice.loaded', { deviceId, deviceType });
            })
            .catch((err) => logger.warn(`[WebAudioEngine] Faust failed: ${err}`));
        return { placeholder, loadPromise };
    },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const WASM_DEVICE_DESCRIPTORS: WasmDeviceDescriptor[] = [
    faustDescriptor,
    fermenterDescriptor,
    toasterDescriptor,
    levainDescriptor,
    proofChamberDescriptor,
    glutenDescriptor,
    bacteriaDescriptor,
    grinderDescriptor,
    proofDescriptor,
    scoringDescriptor,
    grandBouleDescriptor,
];

export function findWasmDescriptor(deviceType: string): WasmDeviceDescriptor | undefined {
    return WASM_DEVICE_DESCRIPTORS.find((d) => d.matches(deviceType));
}
