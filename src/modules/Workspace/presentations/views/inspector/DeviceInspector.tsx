import { type ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';
import { bypassDevice } from '#/modules/Arrangement/useCases/device';
import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { type Device } from '#/modules/Arrangement/useCases/trackQueries';
import { resolveDeviceLayout, SectionHeader, ParamGrid } from './deviceLayoutRegistry';
import './layouts';

type DeviceInspectorProps = {
    device: Device;
    trackId: string;
    onBack: () => void;
};

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    const plugin = BUILTIN_PLUGINS.find(
        (p) =>
            p.id === device.type ||
            p.id === `builtin-${device.type}` ||
            p.name.toLowerCase() === device.type?.toLowerCase() ||
            p.name === device.name
    );
    const parameters = plugin?.parameters ?? [];

    const LayoutComponent = resolveDeviceLayout(device.type ?? '');

    return (
        <div className="space-y-4 p-3">
            {/* ── Header: back button + bypass switch ── */}
            <div className="flex flex-row items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
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
                /* ── Generic fallback: 2-column parameter grid ── */
                <div>
                    <SectionHeader title="Parameters" />
                    <ParamGrid params={parameters} device={device} trackId={trackId} />
                </div>
            ) : (
                <div className="px-1">
                    <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
                </div>
            )}
        </div>
    );
};
