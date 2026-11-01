/**
 * Reverb Layout — Decay visualization, all controls visible.
 */
import { type ReactElement } from 'react';

import { ReverbDecay } from '#/components/daw/visualizers/ReverbDecay';
import { Stack } from '#/components/layout';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { FitWidth } from '../FitWidth';
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

const ReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;

    return (
        <Stack gap={3}>
            <SectionHeader title="Impulse Response" />
            <FitWidth fallbackWidth={240}>
                {(width) => (
                    <ReverbDecay
                        size={pv['rev-size'] ?? 0.5}
                        decay={pv['rev-decay'] ?? 2}
                        damping={pv['rev-damping'] ?? 0.5}
                        predelay={pv['rev-predelay'] ?? 10}
                        width={width}
                        height={70}
                    />
                )}
            </FitWidth>
            <SectionHeader title="Controls" />
            <ParamCardGrid>
                {filterParams(parameters, ['rev-size', 'rev-decay']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            <ParamCardGrid>
                {filterParams(parameters, ['rev-damping', 'rev-predelay']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
            <ParamCardGrid>
                {filterParams(parameters, ['rev-lowcut', 'rev-mix']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </ParamCardGrid>
        </Stack>
    );
};

registerDeviceLayout('builtin-reverb', ReverbLayout);
