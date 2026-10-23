/**
 * Distortion Layout — Interactive waveshaper, all controls visible.
 */
import { type ReactElement } from 'react';

import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
import { Grid, Row, Stack } from '#/components/layout';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { useDeviceParameterGesture } from '../../../hooks/useDeviceParameterGesture';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { SectionHeader } from '../SectionHeader';

type P = DeviceLayoutProps['parameters'][number];
const Param = ({
    param,
    device,
    trackId,
    previewValue,
}: {
    param: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
    previewValue?: number;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={param} device={device} trackId={trackId} previewValue={previewValue} />
    </SurfaceCard>
);

const DistortionLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const driveParameter = parameters.find((param) => param.id === 'dist-drive');
    const gesture = useDeviceParameterGesture({ param: driveParameter, device, trackId });

    return (
        <Stack gap={3}>
            <SectionHeader title="Waveshaper" />
            <Row align="stretch" justify="center">
                <DistortionCurve
                    drive={gesture.value ?? 20}
                    tone={pv['dist-tone'] ?? 4000}
                    mix={pv['dist-mix'] ?? 0.5}
                    width={160}
                    height={130}
                    onParamChange={driveParameter ? (_id, value) => gesture.change(value, true) : undefined}
                    onGestureStart={() => gesture.startGesture()}
                    isGestureCurrent={gesture.isGestureCurrent}
                    onGestureCommit={() => gesture.settleGesture()}
                    onGestureCancel={() => gesture.cancel()}
                />
            </Row>
            <SectionHeader title="Controls" />
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['dist-drive', 'dist-tone']).map((param) => (
                    <Param
                        key={param.id}
                        param={param}
                        device={device}
                        trackId={trackId}
                        previewValue={param.id === 'dist-drive' ? gesture.previewValue : undefined}
                    />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['dist-output', 'dist-mix']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
        </Stack>
    );
};

registerDeviceLayout('builtin-distortion', DistortionLayout);
