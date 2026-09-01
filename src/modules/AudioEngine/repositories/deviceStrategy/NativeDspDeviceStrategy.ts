import { type NoteExpressionControls } from '../../engine/noteExpression';
import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import {
    type AudioDeviceStrategy,
    type DeviceNoteExpressionRequest,
    type DeviceNoteOffRequest,
    type DeviceNoteOnRequest,
    type OfflineAutomationBinding,
    type OfflineAutomationSegment,
} from './AudioDeviceStrategy';
import { findReleasedNativeDspDeviceFactory } from './findReleasedNativeDspDeviceFactory';
import { type NativeDspNode } from './nativeDspDeviceFactories';

/**
 * A DSP node that carries the engine-side expression surface.
 *
 * `NativeDspNode` does not declare `noteExpression`, and Fermenter, Levain and
 * Grand Boule still have one at runtime: the factory table's note binders build
 * the bound node by spreading the engine node, which carries every method it did
 * not rename. Narrowing to it is what lets this strategy forward expression
 * without the declared type having to enumerate a surface only three devices own.
 */
type NoteExpressionCapableNode = NativeDspNode & NoteExpressionControls;

function hasNoteExpressionSurface(node: NativeDspNode): node is NoteExpressionCapableNode {
    return 'noteExpression' in node && typeof node.noteExpression === 'function';
}

export class NativeDspDeviceStrategy implements AudioDeviceStrategy {
    public readonly node: OfflineDeviceNode;
    public readonly runtimeFailure?: Promise<never>;
    public readonly runtimeHealthCheck?: () => Promise<void>;
    public readonly acceptsScheduledParam?: (name: string) => boolean;
    public readonly scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    /**
     * Read off the DSP node the factory table built, not off this class. Every
     * device that comes through here gets the same forwarding methods whether
     * or not the node behind them implements anything, so the methods say
     * nothing about the device; the node's own surface does. Gluten, Proof,
     * Bacteria, Grinder, Knead, ProofChamber and Scoring supply no `noteOn`.
     */
    public readonly acceptsNotes: boolean;
    /**
     * Assigned only when the node behind this strategy really voices per-note
     * expression, unlike `noteOn`/`noteOff` below. A caller reads its presence
     * to decide whether the instrument has an expression path at all, so a
     * method defined on the prototype would claim one for Crumbs and Toaster.
     */
    public readonly noteExpression?: (request: DeviceNoteExpressionRequest) => void;

    constructor(private readonly dspNode: NativeDspNode) {
        this.runtimeFailure = dspNode.runtimeFailure;
        this.runtimeHealthCheck = dspNode.runtimeHealthCheck;
        this.acceptsNotes = dspNode.noteOn !== undefined;
        this.node = {
            inputNode: dspNode.workletNode,
            outputNode: dspNode.workletNode,
            nodes: [dspNode.workletNode],
        };
        const scheduleParam = dspNode.scheduleParam;
        const acceptsScheduledParam = dspNode.acceptsScheduledParam;
        if (scheduleParam && acceptsScheduledParam) {
            this.acceptsScheduledParam = (name) => acceptsScheduledParam(name);
            this.scheduleParam = (name, segments) => scheduleParam(name, segments);
        }
        if (hasNoteExpressionSurface(dspNode)) {
            const expressionNode = dspNode;
            this.noteExpression = ({ noteOrPad, channel, bendSemitones, pressure, slide, sampleFrame }) => {
                expressionNode.noteExpression(noteOrPad, channel, bendSemitones, pressure, slide, sampleFrame);
            };
        }
    }

    setParam(name: string, value: number): void {
        this.dspNode.setParam?.(name, value);
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        const schedule = this.scheduleParam;
        if (!schedule || this.acceptsScheduledParam?.(parameterId) !== true) {
            return null;
        }
        return { kind: 'segments', apply: (segments) => schedule(parameterId, segments) };
    }

    setBypass(bypassed: boolean): void {
        this.dspNode.setBypass?.(bypassed);
    }

    noteOn(request: DeviceNoteOnRequest): void {
        this.dspNode.noteOn?.(request);
    }

    noteOff(request: DeviceNoteOffRequest): void {
        this.dspNode.noteOff?.(request);
    }

    connectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.connectPadOutput?.(pad, destination);
    }

    disconnectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.disconnectPadOutput?.(pad, destination);
    }

    setPadDryRouted(pad: number, routed: boolean): void {
        this.dspNode.setPadDryRouted?.(pad, routed);
    }

    destroy(): void {
        this.dspNode.destroy?.();
    }
}

export async function createNativeDspStrategy(ctx: BaseAudioContext, device: Device): Promise<NativeDspDeviceStrategy> {
    const factory = findReleasedNativeDspDeviceFactory(device.type);
    const result = factory ? await factory.create(ctx) : null;

    if (!result) {
        throw new Error(`Failed to create Native DSP device: ${device.type}`);
    }

    await result.ready;

    const strategy = new NativeDspDeviceStrategy(result);
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    // `parameterValues` is only the numeric half of a device's state: the setup an
    // instrument needs beyond plain params — Levain's instrument identity and
    // sample zones, Toaster's kit — is not reachable from a repository, which may
    // not orchestrate module use cases. `buildDeviceChain` performs it against the
    // returned worklet port instead.
    return strategy;
}
