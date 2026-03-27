/**
 * Device Layout Registry — scalable pattern for device-specific inspector UIs.
 *
 * Each device type registers a layout component that gets the full device
 * context (device, trackId, parameters, parameterValues). DeviceInspector
 * does a simple registry lookup instead of an if/else chain.
 *
 * To add a new device layout:
 *   1. Create a layout component matching DeviceLayoutProps
 *   2. Register it in DEVICE_LAYOUTS with one or more device type keys
 *   3. For prefix-based matching (e.g. all faust-*), use resolveDeviceLayout()
 */
import { type ReactElement, type ComponentType } from 'react';
import { Card } from '#/components/ui/card';
import { type DeviceParameter } from '#/modules/Arrangement/models/DeviceParameter';
import { type Device } from '#/modules/Arrangement/models/Track';
import { DeviceParameterControl } from './DeviceParameterControl';

export type DeviceLayoutProps = {
    device: Device;
    trackId: string;
    parameters: DeviceParameter[];
};

type DeviceLayoutComponent = ComponentType<DeviceLayoutProps>;

/**
 * Registry of device type → layout component.
 * Exact matches are checked first, then prefix matchers.
 */
const EXACT_LAYOUTS = new Map<string, DeviceLayoutComponent>();

type PrefixMatcher = {
    prefix: string;
    component: DeviceLayoutComponent;
};
const PREFIX_LAYOUTS: PrefixMatcher[] = [];

/** Register a layout for one or more exact device type IDs */
export function registerDeviceLayout(deviceTypes: string | string[], component: DeviceLayoutComponent): void {
    const types = Array.isArray(deviceTypes) ? deviceTypes : [deviceTypes];
    for (const t of types) {
        EXACT_LAYOUTS.set(t, component);
    }
}

/** Register a layout for all device types matching a prefix */
export function registerPrefixLayout(prefix: string, component: DeviceLayoutComponent): void {
    PREFIX_LAYOUTS.push({ prefix, component });
}

/** Resolve the layout component for a device type. Returns null for generic fallback. */
export function resolveDeviceLayout(deviceType: string): DeviceLayoutComponent | null {
    // 1. Exact match
    const exact = EXACT_LAYOUTS.get(deviceType);
    if (exact) return exact;

    // 2. Prefix match (first match wins)
    for (const { prefix, component } of PREFIX_LAYOUTS) {
        if (deviceType.startsWith(prefix)) return component;
    }

    return null;
}

// ── Re-export for convenience ──
export type { DeviceLayoutComponent, DeviceParameter, Device };

// ── Common helpers used by layout components ──
export const filterParams = (params: DeviceParameter[], ids: string[]): DeviceParameter[] =>
    params.filter((p) => ids.includes(p.id));

/** Section header with subtle border */
export const SectionHeader = ({ title }: { title: string }): ReactElement => (
    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {title}
        </div>
    </div>
);

/** Responsive parameter card grid used by all effect layouts */
export const ParamGrid = ({
    params,
    device,
    trackId,
    cols = 2,
}: {
    params: DeviceParameter[];
    device: Device;
    trackId: string;
    cols?: number;
}): ReactElement => (
    <div className={`grid grid-cols-1 @md:grid-cols-${cols} gap-2`}>
        {params.map((param) => (
            <Card key={param.id} className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full pb-4">
                <DeviceParameterControl param={param} device={device} trackId={trackId} />
            </Card>
        ))}
    </div>
);
