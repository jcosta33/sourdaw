/**
 * Distortion Layout — Interactive waveshaper, all controls visible.
 */
import { type ReactElement } from 'react';

import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
import { Row, Stack } from '#/components/layout';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { useDeviceParameterGesture } from '../../../hooks/useDeviceParameterGesture';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { ParamCardGrid } from '../ParamCardGrid';
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

type CurveValues = { drive: number; tone: number; mix: number };

const InteractiveDistortionCurve = ({
    param,
    device,
    trackId,
    ...values
}: Pick<DeviceLayoutProps, 'device' | 'trackId'> & { param: P } & CurveValues): ReactElement => {
    const gesture = useDeviceParameterGesture({ param, device, trackId });
    return (
        <DistortionCurve
            {...values}
            drive={gesture.value}
            width={160}
            height={130}
            onParamChange={(_id, value) => gesture.change(value, true)}
            onGestureStart={() => gesture.startGesture()}
            isGestureCurrent={gesture.isGestureCurrent}
            onGestureCommit={() => gesture.settleGesture()}
            onGestureCancel={() => gesture.cancel()}
        />
    );
};

const DistortionLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const driveParameter = parameters.find((param) => param.id === 'dist-drive');
    const curveValues = {
        drive: pv['dist-drive'] ?? 20,
        tone: pv['dist-tone'] ?? 4000,
        mix: pv['dist-mix'] ?? 0.5,
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Waveshaper" />
            <Row align="stretch" justify="center">
                {driveParameter ? (
                    <InteractiveDistortionCurve
                        {...curveValues}
                        param={driveParameter}
                        device={device}
                        trackId={trackId}
                    />
                ) : (
                    <DistortionCurve {...curveValues} width={160} height={130} />
                )}
            </Row>
            <SectionHeader title="Controls" />
            <ParamCardGrid>
                {filterParams(parameters, ['dist-drive', 'dist-tone']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            <ParamCardGrid>
                {filterParams(parameters, ['dist-output', 'dist-mix']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
        </Stack>
    );
};

registerDeviceLayout('builtin-distortion', DistortionLayout);
