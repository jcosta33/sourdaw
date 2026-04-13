/**
 * Compressor Layout — Interactive transfer curve, all controls visible.
 */
import { type ReactElement } from 'react';
import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { SectionHeader } from '../SectionHeader';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

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

const CompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => {
        setDeviceParameter(device.id, id, v);
    };

    return (
        <div className="space-y-3">
            <SectionHeader title="Transfer Curve" />
            <div className="flex justify-center">
                <CompressorCurve
                    threshold={pv['comp-threshold'] ?? -20}
                    ratio={pv['comp-ratio'] ?? 4}
                    knee={pv['comp-knee'] ?? 6}
                    makeup={pv['comp-makeup'] ?? 0}
                    width={140}
                    height={140}
                    onParamChange={change}
                />
            </div>

            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['comp-threshold', 'comp-ratio']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['comp-attack', 'comp-release']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['comp-knee', 'comp-makeup']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-compressor', 'builtin-sidechain-compressor'], CompressorLayout);
