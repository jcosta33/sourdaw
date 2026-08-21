import { type ReactElement } from 'react';

import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { Stack } from '#/components/layout';
import { getBuiltinPlugins, bypassDevice } from '#/modules/Arrangement/useCases';

import { type DeviceParameterView as DeviceParameter } from '../../../models/PluginDescriptorViewTypes';
import { type Device } from '../../../models/TrackViewTypes';
import { InspectorDetailHeader } from '../../components/Inspector/InspectorDetailHeader';
import { MetaText } from '../../components/Inspector/MetaText';

import { resolveDeviceLayout } from './deviceLayoutRegistry';
import { GenericDeviceLayout } from './GenericDeviceLayout';

import './layouts/BuiltinSynthLayout';
import './layouts/FaustInstrumentLayout';
import './layouts/HammondB3Layout';
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

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    const plugin = getBuiltinPlugins().find(
        (param) =>
            param.id === device.type ||
            param.id === `builtin-${device.type}` ||
            param.name.toLowerCase() === device.type?.toLowerCase() ||
            param.name === device.name
    );

    // Use static descriptor params, or derive from parameterValues for Faust/dynamic devices
    const parameters = plugin?.parameters ?? deriveParamsFromValues(device);

    const LayoutComponent = resolveDeviceLayout(device.type ?? '');
    const renderIife_15 = () => {
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
        <Stack gap={4} className="p-3">
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
            {renderIife_15()}
        </Stack>
    );
};
