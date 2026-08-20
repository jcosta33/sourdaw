/**
 * Delay Layout — Tap visualization, all controls visible.
 */
import { type ReactElement } from 'react';

import { DelayTaps } from '#/components/daw/visualizers/DelayTaps';
import { Row, Stack } from '#/components/layout';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { SectionHeader } from '../SectionHeader';

type P = DeviceLayoutProps['parameters'][number];
const Param = ({
    param,
    device,
    trackId,
}: {
    param: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={param} device={device} trackId={trackId} />
    </SurfaceCard>
);

const DelayLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Echo Pattern" />
            <Row align="stretch" justify="center">
                <DelayTaps
                    time={pv['delay-time'] ?? 250}
                    feedback={pv['delay-feedback'] ?? 0.4}
                    mix={pv['delay-mix'] ?? 0.3}
                    width={240}
                    height={60}
                    onParamChange={change}
                />
            </Row>
            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['delay-time', 'delay-feedback']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['delay-lowcut', 'delay-highcut']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['delay-mix']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
        </Stack>
    );
};

registerDeviceLayout('builtin-delay', DelayLayout);
