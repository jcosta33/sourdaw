/**
 * Compressor Layout — Interactive transfer curve, all controls visible.
 */
import { type ReactElement } from 'react';

import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { Row, Stack } from '#/components/layout';
import { dynamicsCompressorHiddenMakeupDb, isCompressorAutoMakeupEngaged } from '#/utils/dynamicsCompressorMakeupLaw';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { useDeviceParameterGesture } from '../../../hooks/useDeviceParameterGesture';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { ParamCardGrid } from '../ParamCardGrid';
import { SectionHeader } from '../SectionHeader';

type P = DeviceLayoutProps['parameters'][number];
type ParameterProps = Pick<DeviceLayoutProps, 'device' | 'trackId'> & { param: P };

const Param = ({ param, device, trackId }: ParameterProps): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={param} device={device} trackId={trackId} />
    </SurfaceCard>
);

type CurveValues = { threshold: number; ratio: number; knee: number; makeup: number; autoMakeup: boolean };

/**
 * The output gain the curve draws: Makeup, plus with Auto Makeup on the gain
 * the browser's compressor derives from the static curve, so the drawn level
 * is the level the device renders.
 */
const drawnMakeup = ({ threshold, ratio, knee, makeup, autoMakeup }: CurveValues): number =>
    autoMakeup ? makeup + dynamicsCompressorHiddenMakeupDb({ thresholdDb: threshold, kneeDb: knee, ratio }) : makeup;

const InteractiveCompressorCurve = ({
    param,
    device,
    trackId,
    ...values
}: ParameterProps & CurveValues): ReactElement => {
    const gesture = useDeviceParameterGesture({ param, device, trackId });
    return (
        <CompressorCurve
            ratio={values.ratio}
            knee={values.knee}
            makeup={drawnMakeup({ ...values, threshold: gesture.value })}
            threshold={gesture.value}
            width={140}
            height={140}
            onParamChange={(_id, value) => gesture.change(value, true)}
            onGestureStart={() => gesture.isGestureCurrent(gesture.startGesture())}
            onGestureCommit={() => gesture.settleGesture()}
            onGestureCancel={() => gesture.cancel()}
        />
    );
};

const CompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const sidechain = device.type === 'builtin-sidechain-compressor';
    const prefix = sidechain ? 'sc-comp' : 'comp';
    const thresholdId = `${prefix}-threshold`;
    const thresholdParameter = parameters.find((param) => param.id === thresholdId);
    const parameterValue = (name: string, fallback: number): number => {
        const id = `${prefix}-${name}`;
        const parameter = parameters.find((param) => param.id === id);
        return pv[id] ?? parameter?.defaultValue ?? parameter?.value ?? fallback;
    };
    const curveValues: CurveValues = {
        threshold: parameterValue('threshold', -20),
        ratio: parameterValue('ratio', 4),
        knee: sidechain ? 0 : parameterValue('knee', 6),
        makeup: parameterValue('makeup', 0),
        // Only `builtin-compressor` runs the browser's makeup; a stored device
        // without the switch reads as on, as it sounded before the switch existed.
        autoMakeup: !sidechain && isCompressorAutoMakeupEngaged(pv['comp-auto-makeup']),
    };
    const autoMakeupParameters = filterParams(parameters, ['comp-auto-makeup']);

    return (
        <Stack gap={3}>
            <SectionHeader title="Transfer Curve" />
            <Row align="stretch" justify="center">
                {thresholdParameter ? (
                    <InteractiveCompressorCurve
                        {...curveValues}
                        param={thresholdParameter}
                        device={device}
                        trackId={trackId}
                    />
                ) : (
                    <CompressorCurve
                        threshold={curveValues.threshold}
                        ratio={curveValues.ratio}
                        knee={curveValues.knee}
                        makeup={drawnMakeup(curveValues)}
                        width={140}
                        height={140}
                    />
                )}
            </Row>
            <SectionHeader title="Controls" />
            <ParamCardGrid>
                {filterParams(parameters, [thresholdId, `${prefix}-ratio`]).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            <ParamCardGrid>
                {filterParams(parameters, [`${prefix}-attack`, `${prefix}-release`]).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            <ParamCardGrid>
                {filterParams(parameters, [`${prefix}-knee`, `${prefix}-makeup`]).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            {autoMakeupParameters.length > 0 && (
                <ParamCardGrid>
                    {autoMakeupParameters.map((param) => (
                        <Param key={param.id} param={param} device={device} trackId={trackId} />
                    ))}
                </ParamCardGrid>
            )}
        </Stack>
    );
};

registerDeviceLayout(['builtin-compressor', 'builtin-sidechain-compressor'], CompressorLayout);
