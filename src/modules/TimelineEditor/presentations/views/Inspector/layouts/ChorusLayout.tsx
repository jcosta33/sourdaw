/**
 * Chorus/Phaser/Flanger Layout — LFO visualization, all controls visible.
 */
import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { ModulationLFO } from '../../../components/ModulationLFO';
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

const ChorusLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const rate = pv['chorus-rate'] ?? pv['phaser-rate'] ?? pv['flanger-rate'] ?? 1.5;
    const depth = pv['chorus-depth'] ?? pv['phaser-depth'] ?? pv['flanger-depth'] ?? 5;
    const renderIife_21 = () => {
        const all = parameters.filter((param) => param.id !== 'phaser-stages');
        const pairs: P[][] = [];
        for (let index = 0; index < all.length; index += 2) {
            pairs.push(all.slice(index, index + 2));
        }
        return pairs.map((pair, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2">
                {pair.map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
        ));
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Modulation" />
            <Row align="stretch" justify="center">
                <ModulationLFO rate={rate} depth={depth} shape="sine" width={240} height={50} />
            </Row>
            <SectionHeader title="Controls" />
            {/* Show all params in pairs of 2 */}
            {renderIife_21()}
            {/* Phaser stages (int, non-automatable) shown separately */}
            {filterParams(parameters, ['phaser-stages']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
        </Stack>
    );
};

registerDeviceLayout(['builtin-chorus', 'builtin-phaser', 'builtin-flanger'], ChorusLayout);
