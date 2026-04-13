/**
 * Device Layout Registry — scalable pattern for device-specific inspector UIs.
 *
 * Each device type registers a layout component that gets the full device
 * context (device, trackId, parameters). DeviceInspector does a simple
 * registry lookup instead of an if/else chain.
 *
 * To add a new device layout:
 *   1. Create a layout component matching DeviceLayoutProps
 *   2. Register it in this registry via registerDeviceLayout()
 *   3. For prefix-based matching (e.g. all faust-*), use registerPrefixLayout()
 *
 * §20.1 — This file is pure data (Map + array) and does not render JSX.
 * The small SectionHeader helper that used to live alongside the
 * registry moved to ./SectionHeader so this file can stay as a plain
 * .ts module and not pretend to be a React component.
 */
import { type ComponentType } from 'react';
import { type DeviceParameterView as DeviceParameter } from '../../../models/PluginDescriptorViewTypes';
import { type Device } from '../../../models/TrackViewTypes';

export type DeviceLayoutProps = {
    device: Device;
    trackId: string;
    parameters: DeviceParameter[];
};

export type DeviceLayoutComponent = ComponentType<DeviceLayoutProps>;

/** Registry of device type → layout component. */
const EXACT_LAYOUTS = new Map<string, DeviceLayoutComponent>();

type PrefixMatcher = {
    prefix: string;
    component: DeviceLayoutComponent;
};
const PREFIX_LAYOUTS: PrefixMatcher[] = [];

/** Register a layout for one or more exact device type IDs. */
export function registerDeviceLayout(deviceTypes: string | string[], component: DeviceLayoutComponent): void {
    const types = Array.isArray(deviceTypes) ? deviceTypes : [deviceTypes];
    for (const t of types) {
        EXACT_LAYOUTS.set(t, component);
    }
}

/** Register a layout for all device types matching a prefix. */
export function registerPrefixLayout(prefix: string, component: DeviceLayoutComponent): void {
    PREFIX_LAYOUTS.push({ prefix, component });
}

/** Resolve the layout component for a device type. Returns null for generic fallback. */
export function resolveDeviceLayout(deviceType: string): DeviceLayoutComponent | null {
    const exact = EXACT_LAYOUTS.get(deviceType);
    if (exact) {
        return exact;
    }
    for (const { prefix, component } of PREFIX_LAYOUTS) {
        if (deviceType.startsWith(prefix)) {
            return component;
        }
    }
    return null;
}

export type { DeviceParameter, Device };

/** Shared filter helper used by layout components. */
export const filterParams = (params: DeviceParameter[], ids: string[]): DeviceParameter[] =>
    params.filter((p) => ids.includes(p.id));
