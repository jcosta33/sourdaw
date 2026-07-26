import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import {
    type AudioDeviceStrategy,
    type OfflineAutomationBinding,
    type OfflineAutomationSegment,
} from './AudioDeviceStrategy';
import { NATIVE_DSP_DEVICE_FACTORIES, type NativeDspNode } from './nativeDspDeviceFactories';

export class NativeDspDeviceStrategy implements AudioDeviceStrategy {
    public readonly node: OfflineDeviceNode;
    public readonly acceptsScheduledParam?: (name: string) => boolean;
    public readonly scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;

    constructor(private readonly dspNode: NativeDspNode) {
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

    noteOn(noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number): void {
        this.dspNode.noteOn?.(noteOrPad, velocity, midiNote, sampleFrame);
    }

    noteOff(noteOrPad: number, sampleFrame?: number): void {
        this.dspNode.noteOff?.(noteOrPad, sampleFrame);
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
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches(device.type));
    const result = factory ? await factory.create(ctx) : null;

    if (!result) {
        throw new Error(`Failed to create Native DSP device: ${device.type}`);
    }

    await result.ready;

    const strategy = new NativeDspDeviceStrategy(result);
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    // `parameterValues` is only the numeric half of a device's state. Every
    // instrument whose live descriptor does setup beyond plain params — Levain's
    // sample zones, Toaster's kit — got none of it here, because this path and the
    // live `wasmDeviceRegistry` are two registries, not one builder with a flag.
    // Levain consequently exported silence. Awaiting this is the point: an offline
    // context renders faster than real time, so a load that is merely started never
    // lands.
    await getAudioDeviceRuntimeSink().prepareOfflineInstrument({
        deviceId: device.id,
        deviceType: device.type,
        port: result.workletNode.port,
    });

    return strategy;
}
