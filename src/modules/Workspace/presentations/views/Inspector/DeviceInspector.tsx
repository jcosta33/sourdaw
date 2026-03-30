import { type ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { BUILTIN_PLUGINS, type DeviceParameter } from '#/modules/Arrangement/useCases/trackQueries';
import { bypassDevice } from '#/modules/Arrangement/useCases/device/bypassDevice';
import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { type Device } from '#/modules/Arrangement/useCases/trackQueries';
import { resolveDeviceLayout } from './deviceLayoutRegistry';
import { GenericDeviceLayout } from './GenericDeviceLayout';
import './layouts';

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
    if (!pv || Object.keys(pv).length === 0) { return []; }

    return Object.entries(pv).map(([id, value]) => {
        const numVal = typeof value === 'number' ? value : 0;
        // Heuristic ranges based on parameter name patterns
        let min = 0;
        let max = 1;
        let unit = '';
        if (/gain|volume|level|mix|output|master/i.test(id)) { max = 1; }
        else if (/freq|cutoff|frequency/i.test(id)) { min = 20; max = 20000; unit = 'Hz'; }
        else if (/attack|decay|release/i.test(id)) { min = 0.001; max = 5; unit = 's'; }
        else if (/rate|speed/i.test(id)) { min = 0; max = 20; unit = 'Hz'; }
        else if (/depth|amount/i.test(id)) { max = 100; }
        else if (/drawbar/i.test(id)) { max = 8; }
        else if (/resonance|q\b/i.test(id)) { min = 0.1; max = 20; }
        else { min = 0; max = Math.max(1, Math.abs(numVal) * 2 || 1); }

        return {
            id,
            deviceId: device.id,
            name: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
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
    const plugin = BUILTIN_PLUGINS.find(
        (p) =>
            p.id === device.type ||
            p.id === `builtin-${device.type}` ||
            p.name.toLowerCase() === device.type?.toLowerCase() ||
            p.name === device.name
    );

    // Use static descriptor params, or derive from parameterValues for Faust/dynamic devices
    const parameters = plugin?.parameters ?? deriveParamsFromValues(device);

    const LayoutComponent = resolveDeviceLayout(device.type ?? '');

    return (
        <div className="space-y-4 p-3">
            {/* ── Header: back button + bypass switch ── */}
            <div
                className="flex flex-row items-center justify-between -mx-3 -mt-3 mb-4 px-3 py-2 border-b border-black/40"
                style={{
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.005) 100%)',
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                }}
            >
                <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="icon-xs" className="hover:bg-surface-raised" onClick={onBack} aria-label="Back to track">
                        <ChevronRight className="size-3 rotate-180" />
                    </Button>
                    <h3 className="text-xs font-medium text-foreground">{device.name}</h3>
                </div>
                <MechanicalSwitch checked={!device.bypassed} onChange={(c) => bypassDevice(device.id, !c)} size="sm" />
            </div>

            {/* ── Registry-based layout ── */}
            {LayoutComponent ? (
                <LayoutComponent device={device} trackId={trackId} parameters={parameters} />
            ) : parameters.length > 0 ? (
                /* ── Smart generic fallback: auto-grouped with collapsible sections ── */
                <GenericDeviceLayout device={device} trackId={trackId} parameters={parameters} />
            ) : (
                <div className="px-1">
                    <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
                </div>
            )}
        </div>
    );
};
