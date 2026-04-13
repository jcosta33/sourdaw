/**
 * Reverb Layout — Decay visualization, all controls visible.
 */
import { type ReactElement } from 'react';
import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { SectionHeader } from '../SectionHeader';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { ReverbDecay } from '#/components/daw/visualizers/ReverbDecay';

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

const ReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;

    return (
        <div className="space-y-3">
            <SectionHeader title="Impulse Response" />
            <div className="flex justify-center">
                <ReverbDecay
                    size={pv['rev-size'] ?? 0.5}
                    decay={pv['rev-decay'] ?? 2}
                    damping={pv['rev-damping'] ?? 0.5}
                    predelay={pv['rev-predelay'] ?? 10}
                    width={240}
                    height={70}
                />
            </div>

            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['rev-size', 'rev-decay']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['rev-damping', 'rev-predelay']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['rev-lowcut', 'rev-mix']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
        </div>
    );
};

registerDeviceLayout('builtin-reverb', ReverbLayout);
