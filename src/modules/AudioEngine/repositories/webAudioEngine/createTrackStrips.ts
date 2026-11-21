import { logger } from '#/infra/logger/appLogger';

import { BusNode } from '../../engine/BusNode';
import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, TrackNode } from '../../engine/TrackNode';

import type { createDeviceReadinessDiagnostics } from '../../engine/deviceReadinessDiagnostics';
import type { BusStrip, TrackChannelStrip } from '../../models/AudioEngineState';
import type { EngineDeviceCollaborators } from '../../models/EngineDeviceCollaborators';
import type { EngineLifecycle } from './createEngineLifecycle';
import type { RuntimeGraphMutation, RuntimeGraphRevision } from './createRuntimeGraphRevision';
import type { SendRouting } from './createSendRouting';
import type { SidechainRouting } from './createSidechainRouting';
import type { ToasterPadBinding, ToasterPadRouting } from './createToasterPadRouting';

/**
 * Why a strip is torn down. Only a strip whose track left the project takes its
 * devices out of the project. A deactivated strip's track keeps its devices
 * without a live strip (a folder whose last Toaster was removed); a graph reset
 * rebuilds the same project, or one a project load commits later, whose own
 * store reset ends the outgoing devices.
 */
type StripTeardown = 'track-removed' | 'strip-deactivated' | 'graph-reset';

export type TrackStrips = {
    /** The live track strips; a bus's backing track node is one of them. Cleared, never replaced. */
    readonly trackNodes: Map<string, TrackNode>;
    readonly busNodes: Map<string, BusNode>;
    /** Load promises of every strip's devices; `waitForDevices` drains it. Cleared, never replaced. */
    readonly pendingDevicePromises: Set<Promise<unknown>>;
    hasRuntimeOutputDestination(outputId: string): boolean;
    createTrackNode(trackId: string): TrackNode;
    ensureTrackStripInGraph(trackId: string): RuntimeGraphMutation<TrackChannelStrip>;
    ensureTrackStrip(trackId: string): TrackChannelStrip;
    removeTrackStrip(trackId: string): void;
    deactivateTrackStrip(trackId: string): void;
    getTrackStrip(trackId: string): TrackChannelStrip | undefined;
    ensureBusStripInGraph(busId: string): RuntimeGraphMutation<BusStrip>;
    ensureBusStrip(busId: string): BusStrip;
    removeBusStrip(busId: string): void;
    setBusGain(busId: string, gain: number): void;
    getBusPeakLevel(busId: string): number;
    setTrackGain(trackId: string, gain: number): void;
    setTrackPan(trackId: string, pan: number): void;
    scheduleTrackGain(trackId: string, gain: number, time: number): void;
    scheduleTrackPan(trackId: string, pan: number, time: number): void;
    cancelTrackAutomationRamps(): void;
    setTrackMute(trackId: string, muted: boolean): void;
    setTrackSoloGate(trackId: string, gated: boolean): void;
    getTrackPeakLevel(trackId: string): number;
    setNativeCarriedTracks(trackIds: ReadonlySet<string>): void;
    /** The carried set names tracks of the project being torn down; a reset forgets it. */
    forgetNativeCarriedTracks(): void;
    reconnectRoutingForTrack(trackId: string): void;
    setTrackOutput(trackId: string, outputId: string, padBinding?: ToasterPadBinding): void;
    setTrackOutputTransaction(
        trackNode: TrackNode,
        outputId: string,
        padBinding: ToasterPadBinding | undefined
    ): RuntimeGraphMutation<void>;
};

export type TrackStripsPorts = Readonly<{
    lifecycle: Pick<EngineLifecycle, 'context' | 'master' | 'isFallback' | 'assertActive'>;
    runtimeGraph: Pick<RuntimeGraphRevision, 'mutate' | 'recordMutation'>;
    sends: Pick<SendRouting, 'sendsForTrack' | 'reconnectTrack' | 'removeSendsFromTrack' | 'removeSendsToBus'>;
    sidechains: Pick<SidechainRouting, 'reconnectTrack' | 'forgetPendingRoutesOf' | 'removeConnectionsOf'>;
    toasterPads: Pick<
        ToasterPadRouting,
        | 'reconcileParent'
        | 'handleDeviceRemoved'
        | 'forgetRoutesOfRemovedStrip'
        | 'snapshotRoute'
        | 'updateBinding'
        | 'restoreBinding'
    >;
    deviceReadinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
    deviceCollaborators: EngineDeviceCollaborators;
    readTransportBuffer: () => SharedArrayBuffer | null;
    getAdjustmentBusForTrack: (trackId: string) => AudioNode | null;
    /**
     * Mute and solo ensure their strip through the assembled engine, so a spec
     * that replaces the engine's `ensureTrackStrip` still sees these calls.
     */
    ensureTrackStripThroughEngine: (trackId: string) => void;
}>;

type StripState = TrackStripsPorts &
    Readonly<{
        trackNodes: Map<string, TrackNode>;
        busNodes: Map<string, BusNode>;
        pendingDevicePromises: Set<Promise<unknown>>;
        /** Tracks the native engine currently carries audibly; strips created later read it too. */
        nativeCarried: { trackIds: ReadonlySet<string> };
    }>;

function combineRollbackErrors(rollbackErrors: readonly unknown[]): unknown {
    if (rollbackErrors.length === 1) {
        return rollbackErrors[0];
    }
    return new AggregateError(rollbackErrors, 'Toaster output transaction restoration failed');
}

function hasRuntimeOutputDestination(state: StripState, outputId: string): boolean {
    return outputId === 'master' || outputId === 'hw_out' || state.trackNodes.has(outputId);
}

function reconnectRoutingForTrack(state: StripState, trackId: string): void {
    const strip = state.trackNodes.get(trackId)?.strip;
    if (!strip) {
        return;
    }
    state.sends.reconnectTrack(trackId, strip);
    state.sidechains.reconnectTrack(trackId, strip);
}

function createTrackNode(state: StripState, trackId: string): TrackNode {
    const { lifecycle, trackNodes, busNodes, sends, toasterPads, runtimeGraph } = state;
    lifecycle.assertActive();
    const context = lifecycle.context();
    if (lifecycle.isFallback()) {
        const sG = context.createGain();
        return new TrackNode(trackId, {
            context,
            masterGainNode: sG,
            getBusGainNode: () => undefined,
            getTrackGainNode: () => undefined,
            getSendsForTrack: () => [],
            pendingDevicePromises: new Set(),
            readinessDiagnostics: state.deviceReadinessDiagnostics,
            collaborators: state.deviceCollaborators,
            getAdjustmentBusForTrack: state.getAdjustmentBusForTrack,
        });
    }
    return new TrackNode(trackId, {
        context,
        masterGainNode: lifecycle.master().gainNode,
        getBusGainNode: (id) => busNodes.get(id)?.strip.gainNode,
        getTrackGainNode: (id) => trackNodes.get(id)?.strip.gainNode,
        getSendsForTrack: (tId) => sends.sendsForTrack(tId),
        pendingDevicePromises: state.pendingDevicePromises,
        readinessDiagnostics: state.deviceReadinessDiagnostics,
        collaborators: state.deviceCollaborators,
        transportSAB: state.readTransportBuffer() ?? undefined,
        getAdjustmentBusForTrack: state.getAdjustmentBusForTrack,
        reconnectRoutingForTrack: (id) => reconnectRoutingForTrack(state, id),
        onDeviceLoaded: (id) => toasterPads.reconcileParent(id),
        onDeviceRemoved: (id, device) => toasterPads.handleDeviceRemoved(id, device),
        onAsyncRuntimeGraphMutation: (mutation) => runtimeGraph.recordMutation(mutation),
    });
}

function ensureTrackStripInGraph(state: StripState, trackId: string): RuntimeGraphMutation<TrackChannelStrip> {
    let node = state.trackNodes.get(trackId);
    let created = false;
    if (!node) {
        node = createTrackNode(state, trackId);
        // A graph rebuild mid-play re-creates the strip with its gates open;
        // carrying is a property of the track, not of this node instance.
        node.setNativeCarried(state.nativeCarried.trackIds.has(trackId));
        state.trackNodes.set(trackId, node);
        created = true;
    }
    return { value: node.strip, changed: created && !state.lifecycle.isFallback() };
}

function removeTrackStripFromGraph(state: StripState, trackId: string, teardown: StripTeardown): boolean {
    const { trackNodes, sends, sidechains } = state;
    const node = trackNodes.get(trackId);
    // TrackNode.dispose() clears deviceNodes. Capture the ids first so all
    // live and pending sidechains targeting this strip can be identified.
    const removedDeviceIds = new Set(node?.strip.deviceNodes.map((device) => device.deviceId) ?? []);

    // Fallback-mode wiring can queue routes without ever materializing a
    // source or target strip. Purge endpoint ownership before the node guard
    // so removing either absent endpoint cannot leave a replayable route.
    sidechains.forgetPendingRoutesOf(trackId, removedDeviceIds);
    state.toasterPads.forgetRoutesOfRemovedStrip(trackId);
    if (!node) {
        return false;
    }

    // Sweep dependent routing keyed on this track as the source, mirroring
    // removeBusStrip's busId sweep. Without this, the send/sidechain GainNodes
    // for the removed track survive in the maps — still wired into their bus /
    // target device, leaking nodes and (for sends) re-summing a ghost tap.
    sends.removeSendsFromTrack(trackId);
    sidechains.removeConnectionsOf(trackId, removedDeviceIds);
    // A track-to-track output is a live edge into the target strip. Preserve
    // the remaining source strips and make the fallback explicit: `hw_out`
    // routes through TrackNode's masterGainNode destination.
    for (const [sourceTrackId, sourceNode] of trackNodes) {
        if (sourceTrackId !== trackId && sourceNode.strip.outputId === trackId) {
            sourceNode.setOutput('hw_out');
        }
    }
    if (teardown === 'track-removed') {
        node.disposeLeavingProject();
    } else {
        node.dispose();
    }
    trackNodes.delete(trackId);
    return !state.lifecycle.isFallback();
}

function ensureBusStripInGraph(state: StripState, busId: string): RuntimeGraphMutation<BusStrip> {
    let node = state.busNodes.get(busId);
    let created = false;
    if (!node) {
        ensureTrackStripInGraph(state, busId);
        const trackNode = state.trackNodes.get(busId);
        if (!trackNode) {
            throw new Error(`Failed to create track strip for bus ${busId}`);
        }
        node = new BusNode(busId, trackNode);
        state.busNodes.set(busId, node);
        created = !state.lifecycle.isFallback();
    }
    return { value: node.strip, changed: created };
}

function removeBusStripFromGraph(state: StripState, busId: string, teardown: StripTeardown): boolean {
    const node = state.busNodes.get(busId);
    if (!node) {
        return false;
    }
    state.sends.removeSendsToBus(busId);
    const removedTrack = removeTrackStripFromGraph(state, busId, teardown);
    node.dispose();
    state.busNodes.delete(busId);
    // BusNode is a facade over its paired TrackNode and owns no AudioNodes.
    // If an enclosing track-removal already disposed that strip, deleting the
    // facade changes no live topology and must not publish a second revision.
    return removedTrack;
}

function restoreTrackOutput(trackNode: TrackNode, previousOutputId: string | undefined): void {
    trackNode.setOutput(previousOutputId ?? 'hw_out');
    if (previousOutputId === undefined) {
        trackNode.strip.outputId = undefined;
    }
}

function setTrackOutputTransaction(
    toasterPads: StripState['toasterPads'],
    trackNode: TrackNode,
    outputId: string,
    padBinding: ToasterPadBinding | undefined
): RuntimeGraphMutation<void> {
    const previousOutputId = trackNode.strip.outputId;
    const padSnapshot = toasterPads.snapshotRoute(trackNode.trackId);
    const outputChanged = trackNode.setOutput(outputId);
    try {
        const padBindingChanged = toasterPads.updateBinding(trackNode.trackId, padBinding);
        return { value: undefined, changed: outputChanged || padBindingChanged };
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        try {
            toasterPads.restoreBinding(trackNode.trackId, trackNode.strip.gainNode, padSnapshot, padBinding);
        } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
        }
        if (outputChanged) {
            try {
                restoreTrackOutput(trackNode, previousOutputId);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length === 0) {
            throw new RuntimeGraphMutationRejected(
                `Track ${trackNode.trackId} output and Toaster pad binding were restored after a live failure`,
                error
            );
        }
        throw new RuntimeGraphMutationFailure(
            Object.freeze({
                application: 'needs-reconcile',
                reason: `Track ${trackNode.trackId} output and Toaster pad binding changed before transaction restoration failed`,
            }),
            error,
            combineRollbackErrors(rollbackErrors)
        );
    }
}

function setTrackOutput(state: StripState, trackId: string, outputId: string, padBinding?: ToasterPadBinding): void {
    try {
        state.runtimeGraph.mutate(() => {
            const trackNode = state.trackNodes.get(trackId);
            if (!trackNode) {
                return { value: undefined, changed: false };
            }
            if (!hasRuntimeOutputDestination(state, outputId)) {
                logger.warn(
                    `[AudioEngine] Rejected output route to absent live destination: ${trackId} -> ${outputId}`
                );
                return { value: undefined, changed: false };
            }
            return setTrackOutputTransaction(state.toasterPads, trackNode, outputId, padBinding);
        });
    } catch (error) {
        if (error instanceof RuntimeGraphMutationFailure) {
            state.runtimeGraph.recordMutation(error.mutation);
        }
        throw error;
    }
}

function cancelTrackAutomationRamps(state: StripState): void {
    if (state.lifecycle.isFallback()) {
        return;
    }
    for (const trackNode of state.trackNodes.values()) {
        trackNode.cancelAutomationRamps();
    }
}

/**
 * The set is the whole answer, not a delta: every live strip is driven to
 * its membership on each call, so a track that has just left the set is
 * reopened in the same pass that closes a track that has just joined.
 */
function setNativeCarriedTracks(state: StripState, trackIds: ReadonlySet<string>): void {
    state.nativeCarried.trackIds = new Set(trackIds);
    for (const [trackId, trackNode] of state.trackNodes) {
        trackNode.setNativeCarried(state.nativeCarried.trackIds.has(trackId));
    }
}

function mutateStripTeardown(state: StripState, removal: () => boolean): void {
    state.runtimeGraph.mutate(() => ({ value: undefined, changed: removal() }));
}

/** Track and bus strips: their creation, teardown, fader, mute, solo and output routing. */
export function createTrackStrips(ports: TrackStripsPorts): TrackStrips {
    const state: StripState = {
        ...ports,
        trackNodes: new Map(),
        busNodes: new Map(),
        pendingDevicePromises: new Set(),
        nativeCarried: { trackIds: new Set() },
    };
    const { trackNodes, busNodes, runtimeGraph } = state;

    return {
        trackNodes,
        busNodes,
        pendingDevicePromises: state.pendingDevicePromises,
        hasRuntimeOutputDestination: (outputId) => hasRuntimeOutputDestination(state, outputId),
        createTrackNode: (trackId) => createTrackNode(state, trackId),
        ensureTrackStripInGraph: (trackId) => ensureTrackStripInGraph(state, trackId),
        ensureTrackStrip: (trackId) => runtimeGraph.mutate(() => ensureTrackStripInGraph(state, trackId)).value,
        removeTrackStrip: (trackId) =>
            mutateStripTeardown(state, () => removeTrackStripFromGraph(state, trackId, 'track-removed')),
        deactivateTrackStrip: (trackId) =>
            mutateStripTeardown(state, () => removeTrackStripFromGraph(state, trackId, 'strip-deactivated')),
        getTrackStrip: (trackId) => trackNodes.get(trackId)?.strip,
        ensureBusStripInGraph: (busId) => ensureBusStripInGraph(state, busId),
        ensureBusStrip: (busId) => runtimeGraph.mutate(() => ensureBusStripInGraph(state, busId)).value,
        removeBusStrip: (busId) =>
            mutateStripTeardown(state, () => removeBusStripFromGraph(state, busId, 'track-removed')),
        setBusGain: (busId, gain) => busNodes.get(busId)?.setGain(gain),
        getBusPeakLevel: (busId) => busNodes.get(busId)?.getPeakLevel() ?? 0,
        setTrackGain: (trackId, gain) => trackNodes.get(trackId)?.setGain(gain),
        setTrackPan: (trackId, pan) => trackNodes.get(trackId)?.setPan(pan),
        scheduleTrackGain: (trackId, gain, time) => trackNodes.get(trackId)?.scheduleGainAutomation(gain, time),
        scheduleTrackPan: (trackId, pan, time) => trackNodes.get(trackId)?.schedulePanAutomation(pan, time),
        cancelTrackAutomationRamps: () => cancelTrackAutomationRamps(state),
        setTrackMute: (trackId, muted) => {
            ports.ensureTrackStripThroughEngine(trackId);
            trackNodes.get(trackId)?.setMute(muted);
        },
        setTrackSoloGate: (trackId, gated) => {
            ports.ensureTrackStripThroughEngine(trackId);
            trackNodes.get(trackId)?.setSoloGate(gated);
        },
        getTrackPeakLevel: (trackId) => trackNodes.get(trackId)?.getPeakLevel() ?? 0,
        setNativeCarriedTracks: (trackIds) => setNativeCarriedTracks(state, trackIds),
        forgetNativeCarriedTracks: () => {
            state.nativeCarried.trackIds = new Set();
        },
        reconnectRoutingForTrack: (trackId) => reconnectRoutingForTrack(state, trackId),
        setTrackOutput: (trackId, outputId, padBinding) => setTrackOutput(state, trackId, outputId, padBinding),
        setTrackOutputTransaction: (trackNode, outputId, padBinding) =>
            setTrackOutputTransaction(state.toasterPads, trackNode, outputId, padBinding),
    };
}
