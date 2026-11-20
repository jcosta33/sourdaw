import { RuntimeGraphMutationFailure } from '../../engine/TrackNode';

import { waitForDeviceLoads } from './waitForDeviceLoads';

import type { createDeviceReadinessDiagnostics } from '../../engine/deviceReadinessDiagnostics';
import type { TrackNode } from '../../engine/TrackNode';
import type {
    AudioDeviceWaitResult,
    BuiltinDeviceNode,
    ToasterDeviceControls,
    TrackChannelStrip,
} from '../../models/AudioEngineState';
import type { BuiltinLufsMeterReading } from '../../models/BuiltinLufsMeterReader';
import type { RuntimeGraphMutation, RuntimeGraphRevision } from './createRuntimeGraphRevision';

type DeviceAddition = Readonly<{
    trackId: string;
    deviceId: string;
    deviceType: string;
    externalInstanceId?: string;
    precedingDeviceIds?: readonly string[];
    parameterIds?: readonly string[];
}>;

type ScheduledDeviceParam = Readonly<{
    trackId: string;
    deviceId: string;
    paramId: string;
    value: number;
    time: number;
}>;

type ScheduledDeviceKey = Readonly<{
    trackId: string;
    deviceId: string;
    pitch: number;
    velocity: number;
    time?: number;
}>;

export type StripDeviceOperations = {
    addDeviceToStrip(addition: DeviceAddition): void;
    removeDeviceFromStrip(trackId: string, deviceId: string): void;
    updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void;
    updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void;
    scheduleDeviceParam(write: ScheduledDeviceParam): void;
    scheduleDeviceKeyOn(key: ScheduledDeviceKey): void;
    scheduleDeviceKeyOff(key: ScheduledDeviceKey): void;
    updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void;
    addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void;
    removeMidiFxFromStrip(trackId: string, fxId: string): void;
    updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void;
    updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void;
    syncKneadState(trackId: string, clips: Record<string, unknown>): void;
    findToasterControls(deviceId: string): ToasterDeviceControls | undefined;
    findLufsMeterReading(deviceId: string): BuiltinLufsMeterReading | null;
    findDeviceOutputNode(deviceId: string): AudioNode | null;
    /** Releases every held note and resets every device controller, one message per device. */
    releaseHeldNotes(): void;
    waitForDevices(timeoutMs?: number): Promise<AudioDeviceWaitResult>;
};

export type StripDeviceOperationsPorts = Readonly<{
    isFallback: () => boolean;
    runtimeGraph: Pick<RuntimeGraphRevision, 'mutate' | 'recordMutation'>;
    /** The live strips, by track id; cleared on reset, never replaced. */
    trackNodes: ReadonlyMap<string, TrackNode>;
    ensureTrackStripInGraph: (trackId: string) => RuntimeGraphMutation<TrackChannelStrip>;
    pendingDevicePromises: Set<Promise<unknown>>;
    deviceReadinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
}>;

function addDeviceToStrip(ports: StripDeviceOperationsPorts, addition: DeviceAddition): void {
    const { runtimeGraph, trackNodes } = ports;
    if (ports.isFallback()) {
        return;
    }
    const { trackId, deviceId, deviceType, externalInstanceId, precedingDeviceIds, parameterIds } = addition;
    // Written inside the mutation, read by the failure path after it.
    const strip = { changed: false };
    try {
        runtimeGraph.mutate(() => {
            strip.changed = ports.ensureTrackStripInGraph(trackId).changed;
            const deviceAdded =
                trackNodes
                    .get(trackId)
                    ?.addDevice(deviceId, deviceType, externalInstanceId, precedingDeviceIds, parameterIds) ?? false;
            return { value: undefined, changed: strip.changed || deviceAdded };
        });
    } catch (error) {
        if (error instanceof RuntimeGraphMutationFailure) {
            runtimeGraph.recordMutation(error.mutation);
        } else if (strip.changed) {
            runtimeGraph.mutate(() => ({ value: undefined, changed: true }));
        }
        throw error;
    }
}

function removeDeviceFromStrip(ports: StripDeviceOperationsPorts, trackId: string, deviceId: string): void {
    if (ports.isFallback()) {
        return;
    }
    try {
        ports.runtimeGraph.mutate(() => ({
            value: undefined,
            changed: ports.trackNodes.get(trackId)?.removeDevice(deviceId) ?? false,
        }));
    } catch (error) {
        if (error instanceof RuntimeGraphMutationFailure) {
            ports.runtimeGraph.recordMutation(error.mutation);
        }
        throw error;
    }
}

/**
 * Owns the strip/device-node traversal so foreign modules never reach into
 * strip internals: the first node with the id on each strip is asked for the
 * value, and the walk moves to the next strip while it has none.
 */
function pickFromDeviceNode<TValue>(
    trackNodes: ReadonlyMap<string, TrackNode>,
    deviceId: string,
    pick: (deviceNode: BuiltinDeviceNode) => TValue | undefined
): TValue | undefined {
    for (const [, trackNode] of trackNodes) {
        const deviceNode = trackNode.strip.deviceNodes.find((dn) => dn.deviceId === deviceId);
        const picked = deviceNode ? pick(deviceNode) : undefined;
        if (picked !== undefined) {
            return picked;
        }
    }
    return undefined;
}

/**
 * Release held notes on every device that can hold one, through the generic
 * `controller.allNotesOff` every instrument descriptor already publishes
 * (`engine/wasmDeviceRegistry.ts`). This used to be a hand-kept branch per
 * device kind — a raw worklet postMessage for Fermenter/Toaster plus explicit
 * Grand Boule and Levain calls — which meant every new instrument had to
 * remember to add itself here or its voices would keep sounding through a stop
 * (audit MD-6). Reading the registry's own surface instead means it cannot drift.
 *
 * One message per device, not a 128-note fan-out: each engine's `allNotesOff`
 * releases every voice internally. Levain in particular uses it to skip the
 * per-note realism release burst that 128 note-offs would turn into an audible
 * "ksshh".
 */
function releaseHeldNotes(trackNodes: ReadonlyMap<string, TrackNode>): void {
    for (const [, trackNode] of trackNodes) {
        for (const dn of trackNode.strip.deviceNodes) {
            dn.controller?.allNotesOff?.();
            dn.controller?.reset?.();
        }
    }
}

function syncKneadState(
    trackNodes: ReadonlyMap<string, TrackNode>,
    trackId: string,
    clips: Record<string, unknown>
): void {
    const trackNode = trackNodes.get(trackId);
    if (trackNode) {
        for (const dn of trackNode.strip.deviceNodes) {
            if (dn.kneadControls) {
                dn.kneadControls.updateState(clips);
            }
        }
    }
}

/** Device and MIDI-FX operations on the live strips; every write is dropped on the fallback graph. */
export function createStripDeviceOperations(ports: StripDeviceOperationsPorts): StripDeviceOperations {
    const { isFallback, trackNodes } = ports;
    /** Runs a live-only write against the track's strip, if it has one. */
    function onLiveTrack(trackId: string, write: (trackNode: TrackNode) => void): void {
        if (isFallback()) {
            return;
        }
        const trackNode = trackNodes.get(trackId);
        if (trackNode) {
            write(trackNode);
        }
    }

    return {
        addDeviceToStrip: (addition) => addDeviceToStrip(ports, addition),
        removeDeviceFromStrip: (trackId, deviceId) => removeDeviceFromStrip(ports, trackId, deviceId),
        updateDeviceParam: (trackId, deviceId, paramId, value) =>
            onLiveTrack(trackId, (node) => node.updateParam(deviceId, paramId, value)),
        updateDevicePatch: (trackId, deviceId, patch) =>
            onLiveTrack(trackId, (node) => node.updatePatch(deviceId, patch)),
        scheduleDeviceParam: ({ trackId, deviceId, paramId, value, time }) =>
            onLiveTrack(trackId, (node) => node.scheduleParam(deviceId, paramId, value, time)),
        scheduleDeviceKeyOn: ({ trackId, deviceId, pitch, velocity, time }) =>
            onLiveTrack(trackId, (node) => node.scheduleDeviceKeyOn(deviceId, pitch, velocity, time)),
        scheduleDeviceKeyOff: ({ trackId, deviceId, pitch, velocity, time }) =>
            onLiveTrack(trackId, (node) => node.scheduleDeviceKeyOff(deviceId, pitch, velocity, time)),
        updateDeviceBypass: (trackId, deviceId, bypassed) => {
            if (isFallback()) {
                return;
            }
            ports.runtimeGraph.mutate(() => ({
                value: undefined,
                changed: trackNodes.get(trackId)?.updateBypass(deviceId, bypassed) ?? false,
            }));
        },
        addMidiFxToStrip: (trackId, fxId, fxType) => onLiveTrack(trackId, (node) => node.addMidiFx(fxId, fxType)),
        removeMidiFxFromStrip: (trackId, fxId) => onLiveTrack(trackId, (node) => node.removeMidiFx(fxId)),
        updateMidiFxParam: (trackId, fxId, paramId, value) =>
            onLiveTrack(trackId, (node) => node.updateMidiFxParam(fxId, paramId, value)),
        updateMidiFxBypass: (trackId, fxId, bypassed) =>
            onLiveTrack(trackId, (node) => node.updateMidiFxBypass(fxId, bypassed)),
        syncKneadState: (trackId, clips) => syncKneadState(trackNodes, trackId, clips),
        findToasterControls: (deviceId) => pickFromDeviceNode(trackNodes, deviceId, (dn) => dn.toasterControls),
        findLufsMeterReading: (deviceId) =>
            pickFromDeviceNode(trackNodes, deviceId, (dn) => dn.lufsMeter?.read()) ?? null,
        findDeviceOutputNode: (deviceId) => pickFromDeviceNode(trackNodes, deviceId, (dn) => dn.outputNode) ?? null,
        releaseHeldNotes: () => releaseHeldNotes(trackNodes),
        waitForDevices: (timeoutMs) =>
            waitForDeviceLoads(
                {
                    trackNodes,
                    pendingDevicePromises: ports.pendingDevicePromises,
                    deviceReadinessDiagnostics: ports.deviceReadinessDiagnostics,
                },
                timeoutMs
            ),
    };
}
