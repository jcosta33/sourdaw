import { dropoutCounters } from '../../engine/dropoutCounter';

import { addCountByType } from './addCountByType';
import { addDeviceResources } from './addDeviceResources';
import { countDeviceRuntimeResources } from './countDeviceRuntimeResources';
import { createEmptyGraphSlotResourcesByLoadState } from './createEmptyGraphSlotResourcesByLoadState';
import { getChromePlaybackStats } from './getChromePlaybackStats';
import { readPlaybackStats } from './readPlaybackStats';
import { toSortedCountRecord } from './toSortedCountRecord';

import type { AdjustmentLayerRuntimeDiagnostics } from '../../engine/AdjustmentLayerRuntime';
import type { BusNode } from '../../engine/BusNode';
import type { createDeviceReadinessDiagnostics } from '../../engine/deviceReadinessDiagnostics';
import type { TrackNode } from '../../engine/TrackNode';
import type {
    AudioEngineDeviceReadinessDiagnostics,
    AudioEngineDiagnostics,
    AudioEngineHealth,
    AudioEngineState,
    AudioProcessorLifecycleState,
} from '../../models/AudioEngineState';
import type { EngineLifecycle } from './createEngineLifecycle';

export type EngineDiagnostics = {
    getHealth(): AudioEngineHealth;
    getDeviceReadinessDiagnostics(): AudioEngineDeviceReadinessDiagnostics;
    isAudioAvailable(): boolean;
    getDiagnostics(): AudioEngineDiagnostics;
    getState(): AudioEngineState;
    resetPlaybackLatencyStats(): void;
};

export type EngineDiagnosticsPorts = Readonly<{
    lifecycle: Pick<
        EngineLifecycle,
        | 'context'
        | 'master'
        | 'isFallback'
        | 'isWorkletReady'
        | 'lastInitError'
        | 'lastResumeError'
        | 'latencyProfile'
        | 'latencyHint'
    >;
    trackNodes: ReadonlyMap<string, TrackNode>;
    busNodes: ReadonlyMap<string, BusNode>;
    readSendCount: () => number;
    readSidechainCount: () => number;
    readAdjustmentDiagnostics: () => AdjustmentLayerRuntimeDiagnostics;
    readScheduledSourceCount: () => number;
    deviceReadinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
}>;

type GraphDiagnostics = AudioEngineDiagnostics['graph'];
type ProcessorLifecycleCounts = { unmanaged: number } & Record<AudioProcessorLifecycleState, number>;

function createFallbackGraphDiagnostics(): GraphDiagnostics {
    return {
        trackStrips: 0,
        busStrips: 0,
        sends: 0,
        sidechains: 0,
        deviceInstances: 0,
        pendingDeviceInstances: 0,
        failedDeviceInstances: 0,
        deviceInstancesByType: {},
        deviceAudioNodes: 0,
        graphSlotResourcesByLoadState: createEmptyGraphSlotResourcesByLoadState(),
        deviceAudioWorkletProcessors: 0,
        deviceAudioWorkletProcessorsByType: {},
        stripMeterWorklets: 0,
        masterMeterWorklets: 0,
        graphAudioWorkletProcessors: 0,
        workerInstances: 0,
        workerInstancesByType: {},
        adjustmentLayerBuses: 0,
        adjustmentLayerBusesByEffectType: {},
        adjustmentLayerAudioNodes: 0,
        adjustmentLayerAudioWorkletProcessors: 0,
    };
}

/** A context that predates a latency field leaves it undefined at runtime, whatever its declared type says. */
function readReportedLatency(latencySeconds: number | undefined): number {
    return latencySeconds ?? 0;
}

type StripCensus = {
    readonly deviceInstancesByType: Map<string, number>;
    readonly deviceAudioWorkletProcessorsByType: Map<string, number>;
    readonly workerInstancesByType: Map<string, number>;
    readonly graphSlotResourcesByLoadState: GraphDiagnostics['graphSlotResourcesByLoadState'];
    readonly processorLifecycle: ProcessorLifecycleCounts;
    deviceInstances: number;
    pendingDeviceInstances: number;
    failedDeviceInstances: number;
    deviceAudioNodes: number;
    deviceAudioWorkletProcessors: number;
    workerInstances: number;
    stripMeterWorklets: number;
};

function createStripCensus(): StripCensus {
    return {
        deviceInstancesByType: new Map(),
        deviceAudioWorkletProcessorsByType: new Map(),
        workerInstancesByType: new Map(),
        graphSlotResourcesByLoadState: createEmptyGraphSlotResourcesByLoadState(),
        processorLifecycle: { unmanaged: 0, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
        deviceInstances: 0,
        pendingDeviceInstances: 0,
        failedDeviceInstances: 0,
        deviceAudioNodes: 0,
        deviceAudioWorkletProcessors: 0,
        workerInstances: 0,
        stripMeterWorklets: 0,
    };
}

function countDevice(
    census: StripCensus,
    trackNode: TrackNode,
    device: TrackNode['strip']['deviceNodes'][number]
): void {
    const resources = countDeviceRuntimeResources(device);
    census.deviceAudioNodes += resources.audioNodes;
    census.deviceAudioWorkletProcessors += resources.audioWorkletProcessors;
    const lifecycleState = device.processorLifecycle?.() ?? null;
    if (lifecycleState && resources.audioWorkletProcessors > 0) {
        census.processorLifecycle[lifecycleState]++;
        census.processorLifecycle.unmanaged += resources.audioWorkletProcessors - 1;
    } else {
        census.processorLifecycle.unmanaged += resources.audioWorkletProcessors;
    }
    addCountByType(census.deviceAudioWorkletProcessorsByType, device.type, resources.audioWorkletProcessors);
    census.workerInstances += resources.workers;
    addCountByType(census.workerInstancesByType, device.type, resources.workers);
    const loadState = trackNode.getDeviceLoadState(device.deviceId);
    addDeviceResources(census.graphSlotResourcesByLoadState[loadState], resources);
    if (loadState === 'pending') {
        census.pendingDeviceInstances++;
        return;
    }
    if (loadState === 'failed') {
        census.failedDeviceInstances++;
        return;
    }
    census.deviceInstances++;
    addCountByType(census.deviceInstancesByType, device.type, 1);
}

function censusStrips(trackNodes: ReadonlyMap<string, TrackNode>): StripCensus {
    const census = createStripCensus();
    for (const trackNode of trackNodes.values()) {
        if (trackNode.strip.meterNode) {
            census.stripMeterWorklets++;
        }
        for (const device of trackNode.strip.deviceNodes) {
            countDevice(census, trackNode, device);
        }
    }
    return census;
}

function getHealth(lifecycle: EngineDiagnosticsPorts['lifecycle']): AudioEngineHealth {
    return {
        workletReady: lifecycle.isWorkletReady(),
        lastInitError: lifecycle.lastInitError(),
        lastResumeError: lifecycle.lastResumeError(),
        // Read straight out of the shared counters (audit RT-10) — no message
        // round-trip, no polling of the audio thread. See dropoutCounter.ts
        // for exactly which dropouts this does and does not capture.
        dropouts: dropoutCounters.read(),
    };
}

function getState(lifecycle: EngineDiagnosticsPorts['lifecycle']): AudioEngineState {
    if (lifecycle.isFallback()) {
        return {
            isReady: false,
            sampleRate: 44100,
            state: 'closed',
            masterGain: 0,
            currentTime: 0,
            baseLatency: 0,
            outputLatency: 0,
        };
    }
    const context = lifecycle.context();
    return {
        isReady: context.state === 'running' || lifecycle.isWorkletReady(),
        sampleRate: context.sampleRate,
        state: context.state,
        masterGain: lifecycle.master().gainNode.gain.value,
        currentTime: context.currentTime,
        baseLatency: readReportedLatency(context.baseLatency),
        outputLatency: readReportedLatency(context.outputLatency),
    };
}

function readLiveGraphDiagnostics(ports: EngineDiagnosticsPorts): Omit<AudioEngineDiagnostics, 'context'> {
    const { lifecycle, trackNodes, busNodes } = ports;
    const census = censusStrips(trackNodes);
    const masterMeterWorklets = lifecycle.master().meterNode() instanceof AudioWorkletNode ? 1 : 0;
    const adjustmentDiagnostics = ports.readAdjustmentDiagnostics();
    census.processorLifecycle.unmanaged += adjustmentDiagnostics.audioWorkletProcessors;
    const graphAudioWorkletProcessors =
        census.deviceAudioWorkletProcessors +
        adjustmentDiagnostics.audioWorkletProcessors +
        census.stripMeterWorklets +
        masterMeterWorklets;
    const playback = readPlaybackStats(lifecycle.context());

    return {
        playback,
        graph: {
            // A bus owns a backing TrackNode; keep the public counters disjoint.
            trackStrips: trackNodes.size - busNodes.size,
            busStrips: busNodes.size,
            sends: ports.readSendCount(),
            sidechains: ports.readSidechainCount(),
            deviceInstances: census.deviceInstances,
            pendingDeviceInstances: census.pendingDeviceInstances,
            failedDeviceInstances: census.failedDeviceInstances,
            deviceInstancesByType: toSortedCountRecord(census.deviceInstancesByType),
            deviceAudioNodes: census.deviceAudioNodes,
            graphSlotResourcesByLoadState: census.graphSlotResourcesByLoadState,
            deviceAudioWorkletProcessors: census.deviceAudioWorkletProcessors,
            deviceAudioWorkletProcessorsByType: toSortedCountRecord(census.deviceAudioWorkletProcessorsByType),
            stripMeterWorklets: census.stripMeterWorklets,
            masterMeterWorklets,
            graphAudioWorkletProcessors,
            workerInstances: census.workerInstances,
            workerInstancesByType: toSortedCountRecord(census.workerInstancesByType),
            adjustmentLayerBuses: adjustmentDiagnostics.buses,
            adjustmentLayerBusesByEffectType: adjustmentDiagnostics.busesByEffectType,
            adjustmentLayerAudioNodes: adjustmentDiagnostics.audioNodes,
            adjustmentLayerAudioWorkletProcessors: adjustmentDiagnostics.audioWorkletProcessors,
        },
        runtime: {
            trackedAudioScheduledSources: ports.readScheduledSourceCount(),
            processorLifecycle: census.processorLifecycle,
        },
    };
}

function getDiagnostics(ports: EngineDiagnosticsPorts): AudioEngineDiagnostics {
    const { lifecycle } = ports;
    const engineState = getState(lifecycle);
    const context = {
        state: engineState.state,
        sampleRate: engineState.sampleRate,
        baseLatency: engineState.baseLatency,
        outputLatency: engineState.outputLatency,
        latencyProfile: lifecycle.latencyProfile,
        latencyHint: lifecycle.latencyHint,
    };
    if (lifecycle.isFallback()) {
        return {
            context,
            playback: null,
            graph: createFallbackGraphDiagnostics(),
            runtime: {
                trackedAudioScheduledSources: 0,
                processorLifecycle: { unmanaged: 0, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
            },
        };
    }
    return { context, ...readLiveGraphDiagnostics(ports) };
}

/** Health, state and resource census of the live graph, read on demand and never polled from the audio thread. */
export function createEngineDiagnostics(ports: EngineDiagnosticsPorts): EngineDiagnostics {
    const { lifecycle } = ports;
    return {
        getHealth: () => getHealth(lifecycle),
        getDeviceReadinessDiagnostics: () => ports.deviceReadinessDiagnostics.snapshot(),
        isAudioAvailable: () => !lifecycle.isFallback(),
        getDiagnostics: () => getDiagnostics(ports),
        getState: () => getState(lifecycle),
        resetPlaybackLatencyStats: () => {
            if (lifecycle.isFallback()) {
                return;
            }
            getChromePlaybackStats(lifecycle.context()).resetLatency();
        },
    };
}
