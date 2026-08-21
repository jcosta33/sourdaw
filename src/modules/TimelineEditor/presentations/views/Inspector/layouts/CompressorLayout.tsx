/**
 * Compressor Layout — Interactive transfer curve, all controls visible.
 */
import { type ReactElement } from 'react';

import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { Grid, Row, Stack } from '#/components/layout';
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

const CompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Transfer Curve" />
            <Row align="stretch" justify="center">
                <CompressorCurve
                    threshold={pv['comp-threshold'] ?? -20}
                    ratio={pv['comp-ratio'] ?? 4}
                    knee={pv['comp-knee'] ?? 6}
                    makeup={pv['comp-makeup'] ?? 0}
                    width={140}
                    height={140}
                    onParamChange={change}
                />
            </Row>
            <SectionHeader title="Controls" />
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['comp-threshold', 'comp-ratio']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['comp-attack', 'comp-release']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['comp-knee', 'comp-makeup']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
        </Stack>
    );
};

registerDeviceLayout(['builtin-compressor', 'builtin-sidechain-compressor'], CompressorLayout);
