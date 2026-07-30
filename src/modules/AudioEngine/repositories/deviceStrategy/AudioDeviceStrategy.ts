import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import { UnsupportedDeviceTypeError } from './unsupportedDeviceTypeError';

export type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

/** A single AudioParam an offline automation lane drives, with its unit scaling. */
export type OfflineAutomationTarget = {
    readonly audioParam: AudioParam;
    readonly scale: number;
    readonly offset: number;
};

/**
 * How offline device-param automation for one parameter reaches a device. A
 * device either exposes one or more real `AudioParam`s (scheduled with the
 * shared AU-1 curve kernel) or accepts frame-addressed segments its worklet
 * interpolates. This is the single capability the offline scheduler routes all
 * device automation through — no hardcoded param map, no opt-in node list
 * (finding OE-3).
 */
export type OfflineAutomationBinding =
    | { readonly kind: 'audioParam'; readonly targets: readonly OfflineAutomationTarget[] }
    | { readonly kind: 'segments'; readonly apply: (segments: readonly OfflineAutomationSegment[]) => void };

export type AudioDeviceStrategy = {
    readonly node: OfflineDeviceNode;
    setParam(name: string, value: number): void;
    /**
     * Resolve how offline automation of `parameterId` reaches this device, or
     * `null` when the device cannot automate that parameter offline. Every
     * automatable device implements this; the offline scheduler asks each device
     * rather than consulting an allow-list (OE-3).
     */
    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null;
    acceptsScheduledParam?(name: string): boolean;
    scheduleParam?(name: string, segments: readonly OfflineAutomationSegment[]): void;
    setBypass?(bypassed: boolean): void;
    noteOn?(noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number): void;
    noteOff?(noteOrPad: number, sampleFrame?: number): void;
    connectPadOutput?(pad: number, destination: AudioNode): void;
    disconnectPadOutput?(pad: number, destination: AudioNode): void;
    setPadDryRouted?(pad: number, routed: boolean): void;
    destroy?(): void;
};

export type DeviceCreator = (
    ctx: BaseAudioContext,
    device: Device
) => Promise<AudioDeviceStrategy> | AudioDeviceStrategy;

export class DeviceFactoryRegistry {
    private matchers: Array<{ test: (type: string) => boolean; creator: DeviceCreator }> = [];

    register(test: string | ((type: string) => boolean), creator: DeviceCreator): void {
        const isMatch = typeof test === 'string' ? (type: string) => type.startsWith(test) : test;
        this.matchers.push({ test: isMatch, creator });
    }

    async createDevice(ctx: BaseAudioContext, device: Device): Promise<AudioDeviceStrategy> {
        for (const matcher of this.matchers) {
            if (matcher.test(device.type)) {
                return matcher.creator(ctx, device);
            }
        }
        throw new UnsupportedDeviceTypeError(device.type, 'no registered factory matches this device type');
    }
}
