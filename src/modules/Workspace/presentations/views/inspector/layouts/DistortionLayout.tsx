/**
 * Distortion Layout — Interactive waveshaper, all controls visible.
 */
import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { type DeviceLayoutProps, SectionHeader, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';

type P = DeviceLayoutProps['parameters'][number];
const Param = ({ p, device, trackId }: { p: P; device: DeviceLayoutProps['device']; trackId: string }): ReactElement => (
    <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 w-full">
        <DeviceParameterControl param={p} device={device} trackId={trackId} />
    </Card>
);

const DistortionLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => { setDeviceParameter(device.id, id, v); };

    return (
        <div className="space-y-3">
            <SectionHeader title="Waveshaper" />
            <div className="flex justify-center">
                <DistortionCurve
                    drive={pv['dist-drive'] ?? 20} tone={pv['dist-tone'] ?? 4000}
                    mix={pv['dist-mix'] ?? 0.5} width={160} height={130} onParamChange={change}
                />
            </div>

            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['dist-drive', 'dist-tone']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['dist-output', 'dist-mix']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
        </div>
    );
};

registerDeviceLayout('builtin-distortion', DistortionLayout);
