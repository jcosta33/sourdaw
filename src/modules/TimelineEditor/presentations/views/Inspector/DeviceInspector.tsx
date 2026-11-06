import { type ReactElement } from 'react';

import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import {
    bypassDevice,
    getAutomationDeviceDescriptor,
    getBuiltinPlugins,
    isExternalPluginDeviceType,
} from '#/modules/Arrangement/useCases';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
    type ExternalPluginParameterState,
} from '#/modules/PluginHost/stores';

import { type DeviceParameterView as DeviceParameter } from '../../../models/PluginDescriptorViewTypes';
import { type Device } from '../../../models/TrackViewTypes';
import { InspectorDetailHeader } from '../../components/Inspector/InspectorDetailHeader';
import { MetaText } from '../../components/Inspector/MetaText';

import { resolveDeviceLayout } from './deviceLayoutRegistry';
import { GenericDeviceLayout } from './GenericDeviceLayout';
import { resolveDevicePlugin } from './resolveDevicePlugin';

import './layouts/BuiltinSynthLayout';
import './layouts/BuiltinLufsMeterLayout';
import './layouts/FaustInstrumentLayout';
import './layouts/HammondB3Layout';
import './layouts/LufsMeterLayout';
import './layouts/effects';

type DeviceInspectorProps = {
    device: Device;
    trackId: string;
    onBack: () => void;
};

/**
 * Derive parameters from a device's parameterValues when no static descriptor exists.
 * This handles Faust instruments whose params vary per module.
 */
function deriveParamsFromValues(device: Device): DeviceParameter[] {
    const pv = device.parameterValues;
    if (!pv || Object.keys(pv).length === 0) {
        return [];
    }

    return Object.entries(pv).map(([id, value]) => {
        const numVal = typeof value === 'number' ? value : 0;
        // Heuristic ranges based on parameter name patterns
        let min = 0;
        let max: number;
        let unit = '';
        if (/gain|volume|level|mix|output|master/i.test(id)) {
            max = 1;
        } else if (/freq|cutoff|frequency/i.test(id)) {
            min = 20;
            max = 20000;
            unit = 'Hz';
        } else if (/attack|decay|release/i.test(id)) {
            min = 0.001;
            max = 5;
            unit = 's';
        } else if (/rate|speed/i.test(id)) {
            min = 0;
            max = 20;
            unit = 'Hz';
        } else if (/depth|amount/i.test(id)) {
            max = 100;
        } else if (/drawbar/i.test(id)) {
            max = 8;
        } else if (/resonance|q\b/i.test(id)) {
            min = 0.1;
            max = 20;
        } else {
            min = 0;
            max = Math.max(1, Math.abs(numVal) * 2 || 1);
        }

        return {
            id,
            deviceId: device.id,
            name: id.replaceAll('_', ' ').replaceAll(/\b\w/g, (context) => context.toUpperCase()),
            type: 'float' as const,
            value: numVal,
            defaultValue: numVal,
            minValue: min,
            maxValue: max,
            unit,
            automatable: true,
            hasAutomation: false,
        };
    });
}

/**
 * The controls of an external plugin device: the parameters its attached instance publishes, as the
 * host's published view. Undefined when the device names no instance or the instance is not attached
 * to the engine, so there is nothing to edit. The state is an input so a published change re-renders.
 */
function externalPluginParameters(device: Device, state: ExternalPluginParameterState): DeviceParameter[] | undefined {
    const instanceId = device.externalInstanceId;
    if (instanceId === undefined || !state.byInstanceId[instanceId]?.engineAttached) {
        return undefined;
    }
    const descriptor = getAutomationDeviceDescriptor(device.type ?? '', instanceId);
    return descriptor ? [...descriptor.parameters] : undefined;
}

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    // Subscribed so the panel follows a plugin's load, refresh and unload.
    const externalState = useStore(externalPluginParameterStore, defaultExternalPluginParameterState);

    const isExternal = isExternalPluginDeviceType(device.type);
    const plugin = resolveDevicePlugin(getBuiltinPlugins(), device);
    const externalParameters = isExternal ? externalPluginParameters(device, externalState) : undefined;

    // Use static descriptor params, or derive from parameterValues for Faust/dynamic devices
    const parameters = isExternal ? (externalParameters ?? []) : (plugin?.parameters ?? deriveParamsFromValues(device));

    const LayoutComponent = isExternal ? undefined : resolveDeviceLayout(device.type ?? '');
    const renderDeviceLayout = (): ReactElement => {
        if (isExternal && externalParameters === undefined) {
            return (
                <div className="px-1">
                    <MetaText>Load this plugin in the desktop app to edit its parameters.</MetaText>
                </div>
            );
        }
        if (LayoutComponent) {
            return <LayoutComponent device={device} trackId={trackId} parameters={parameters} />;
        }
        if (parameters.length > 0) {
            return <GenericDeviceLayout device={device} trackId={trackId} parameters={parameters} />;
        }
        return (
            <div className="px-1">
                <MetaText>No parameters available for this device.</MetaText>
            </div>
        );
    };

    return (
        <Stack gap={4} className="@container p-3">
            <InspectorDetailHeader
                title={<h3 className="truncate text-xs font-medium text-foreground">{device.name}</h3>}
                onBack={onBack}
                backLabel="Back to track"
                actions={
                    <MechanicalSwitch
                        checked={!device.bypassed}
                        onChange={(context) => bypassDevice(device.id, !context)}
                        size="sm"
                    />
                }
            />
            {/* ── Registry-based layout ── */}
            {renderDeviceLayout()}
        </Stack>
    );
};
