/**
 * EQ Layout — Interactive 3-band parametric equalizer.
 * All controls visible — 9 params is manageable without collapsing.
 */
import { type ReactElement } from 'react';

import { EQCurve } from '#/components/daw/visualizers/EQCurve';
import { Row, Stack } from '#/components/layout';
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

const EQLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    return (
        <Stack gap={3}>
            <SectionHeader title="Frequency Response" />
            <Row align="stretch" justify="center">
                <EQCurve
                    lowGain={pv['eq-low-gain'] ?? 0}
                    lowFreq={pv['eq-low-freq'] ?? 100}
                    lowQ={pv['eq-low-q'] ?? 1}
                    midGain={pv['eq-mid-gain'] ?? 0}
                    midFreq={pv['eq-mid-freq'] ?? 1000}
                    midQ={pv['eq-mid-q'] ?? 1}
                    highGain={pv['eq-high-gain'] ?? 0}
                    highFreq={pv['eq-high-freq'] ?? 8000}
                    highQ={pv['eq-high-q'] ?? 1}
                    width={240}
                    height={100}
                    onParamChange={change}
                />
            </Row>
            <SectionHeader title="Low Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-low-gain', 'eq-low-freq']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-low-q']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
            <SectionHeader title="Mid Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-mid-gain', 'eq-mid-freq']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-mid-q']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
            <SectionHeader title="High Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-high-gain', 'eq-high-freq']).map((param) => (
                    <Param key={param.id} param={param} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-high-q']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
        </Stack>
    );
};

registerDeviceLayout('builtin-eq', EQLayout);
