/**
 * Reverb Layout — Decay visualization, all controls visible.
 */
import { type ReactElement } from 'react';

import { ReverbDecay } from '#/components/daw/visualizers/ReverbDecay';
import { Grid, Row, Stack } from '#/components/layout';

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

const ReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;

    return (
        <Stack gap={3}>
            <SectionHeader title="Impulse Response" />
            <Row align="stretch" justify="center">
                <ReverbDecay
                    size={pv['rev-size'] ?? 0.5}
                    decay={pv['rev-decay'] ?? 2}
                    damping={pv['rev-damping'] ?? 0.5}
                    predelay={pv['rev-predelay'] ?? 10}
                    width={240}
                    height={70}
                />
            </Row>
            <SectionHeader title="Controls" />
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['rev-size', 'rev-decay']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['rev-damping', 'rev-predelay']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
            <Grid cols={2} gap={2}>
                {filterParams(parameters, ['rev-lowcut', 'rev-mix']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </Grid>
        </Stack>
    );
};

registerDeviceLayout('builtin-reverb', ReverbLayout);
