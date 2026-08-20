/**
 * Distortion Layout — Interactive waveshaper, all controls visible.
 */
import { type ReactElement } from 'react';

import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
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

const DistortionLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Waveshaper" />
            <Row align="stretch" justify="center">
                <DistortionCurve
                    drive={pv['dist-drive'] ?? 20}
                    tone={pv['dist-tone'] ?? 4000}
                    mix={pv['dist-mix'] ?? 0.5}
                    width={160}
                    height={130}
                    onParamChange={change}
                />
            </Row>
            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['dist-drive', 'dist-tone']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['dist-output', 'dist-mix']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
        </Stack>
    );
};

registerDeviceLayout('builtin-distortion', DistortionLayout);
