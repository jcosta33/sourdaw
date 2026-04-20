/**
 * Chorus/Phaser/Flanger Layout — LFO visualization, all controls visible.
 */
import { type ReactElement } from 'react';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { ModulationLFO } from '../../../components/ModulationLFO';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { SectionHeader } from '../SectionHeader';

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

const ChorusLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const rate = pv['chorus-rate'] ?? pv['phaser-rate'] ?? pv['flanger-rate'] ?? 1.5;
    const depth = pv['chorus-depth'] ?? pv['phaser-depth'] ?? pv['flanger-depth'] ?? 5;

    return (
        <div className="space-y-3">
            <SectionHeader title="Modulation" />
            <div className="flex justify-center">
                <ModulationLFO rate={rate} depth={depth} shape="sine" width={240} height={50} />
            </div>

            <SectionHeader title="Controls" />
            {/* Show all params in pairs of 2 */}
            {(() => {
                const all = parameters.filter((p) => p.id !== 'phaser-stages');
                const pairs: P[][] = [];
                for (let i = 0; i < all.length; i += 2) {
                    pairs.push(all.slice(i, i + 2));
                }
                return pairs.map((pair, idx) => (
                    <div key={idx} className="grid grid-cols-2 gap-2">
                        {pair.map((p) => (
                            <Param key={p.id} p={p} device={device} trackId={trackId} />
                        ))}
                    </div>
                ));
            })()}

            {/* Phaser stages (int, non-automatable) shown separately */}
            {filterParams(parameters, ['phaser-stages']).map((p) => (
                <Param key={p.id} p={p} device={device} trackId={trackId} />
            ))}
        </div>
    );
};

registerDeviceLayout(['builtin-chorus', 'builtin-phaser', 'builtin-flanger'], ChorusLayout);
