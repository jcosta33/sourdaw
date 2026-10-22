/**
 * Compressor Layout — Interactive transfer curve, all controls visible.
 */
import { type ReactElement } from 'react';

import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
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

const CompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const sidechain = device.type === 'builtin-sidechain-compressor';
    const prefix = sidechain ? 'sc-comp' : 'comp';
    const thresholdId = `${prefix}-threshold`;
    const thresholdParameter = parameters.find((param) => param.id === thresholdId);
    const gesture = useDeviceParameterGesture({ param: thresholdParameter, device, trackId });
    const parameterValue = (name: string, fallback: number): number => {
        const id = `${prefix}-${name}`;
        const parameter = parameters.find((param) => param.id === id);
        return pv[id] ?? parameter?.defaultValue ?? parameter?.value ?? fallback;
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Transfer Curve" />
            <Row align="stretch" justify="center">
                <CompressorCurve
                    threshold={gesture.value ?? parameterValue('threshold', -20)}
                    ratio={parameterValue('ratio', 4)}
                    knee={sidechain ? 0 : parameterValue('knee', 6)}
                    makeup={parameterValue('makeup', 0)}
                    width={140}
                    height={140}
                    onParamChange={thresholdParameter ? (_id, value) => gesture.change(value, true) : undefined}
                    onGestureStart={() => gesture.isGestureCurrent(gesture.startGesture())}
                    onGestureCommit={() => gesture.settleGesture()}
                    onGestureCancel={() => gesture.cancel()}
                />
            </Row>
            <SectionHeader title="Controls" />
            <Grid cols={2} gap={2}>
                {filterParams(parameters, [thresholdId, `${prefix}-ratio`]).map((param) => (
                    <Param
                        key={param.id}
                        param={param}
                        device={device}
                        trackId={trackId}
                        previewValue={param.id === thresholdId ? gesture.previewValue : undefined}
                    />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, [`${prefix}-attack`, `${prefix}-release`]).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, [`${prefix}-knee`, `${prefix}-makeup`]).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
        </Stack>
    );
};

registerDeviceLayout(['builtin-compressor', 'builtin-sidechain-compressor'], CompressorLayout);
