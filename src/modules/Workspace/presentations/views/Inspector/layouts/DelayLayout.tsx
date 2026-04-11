/**
 * Delay Layout — Tap visualization, all controls visible.
 */
import { type ReactElement } from 'react';
import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, SectionHeader, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { DelayTaps } from '#/components/daw/visualizers/DelayTaps';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

type P = DeviceLayoutProps['parameters'][number];
const Param = ({
    p,
    device,
    trackId,
}: {
    p: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={p} device={device} trackId={trackId} />
    </SurfaceCard>
);

const DelayLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => {
        setDeviceParameter(device.id, id, v);
    };

    return (
        <div className="space-y-3">
            <SectionHeader title="Echo Pattern" />
            <div className="flex justify-center">
                <DelayTaps
                    time={pv['delay-time'] ?? 250}
                    feedback={pv['delay-feedback'] ?? 0.4}
                    mix={pv['delay-mix'] ?? 0.3}
                    width={240}
                    height={60}
                    onParamChange={change}
                />
            </div>

            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['delay-time', 'delay-feedback']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['delay-lowcut', 'delay-highcut']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['delay-mix']).map((p) => (
                <Param key={p.id} p={p} device={device} trackId={trackId} />
            ))}
        </div>
    );
};

registerDeviceLayout('builtin-delay', DelayLayout);
