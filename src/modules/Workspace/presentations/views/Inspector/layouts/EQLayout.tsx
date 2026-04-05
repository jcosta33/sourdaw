/**
 * EQ Layout — Interactive 3-band parametric equalizer.
 * All controls visible — 9 params is manageable without collapsing.
 */
import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { type DeviceLayoutProps, SectionHeader, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { EQCurve } from '#/components/daw/visualizers/EQCurve';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';

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
    <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 w-full">
        <DeviceParameterControl param={p} device={device} trackId={trackId} />
    </Card>
);

const EQLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => {
        setDeviceParameter(device.id, id, v);
    };

    return (
        <div className="space-y-3">
            <SectionHeader title="Frequency Response" />
            <div className="flex justify-center">
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
            </div>

            <SectionHeader title="Low Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-low-gain', 'eq-low-freq']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-low-q']).map((p) => (
                <Param key={p.id} p={p} device={device} trackId={trackId} />
            ))}

            <SectionHeader title="Mid Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-mid-gain', 'eq-mid-freq']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-mid-q']).map((p) => (
                <Param key={p.id} p={p} device={device} trackId={trackId} />
            ))}

            <SectionHeader title="High Band" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['eq-high-gain', 'eq-high-freq']).map((p) => (
                    <Param key={p.id} p={p} device={device} trackId={trackId} />
                ))}
            </div>
            {filterParams(parameters, ['eq-high-q']).map((p) => (
                <Param key={p.id} p={p} device={device} trackId={trackId} />
            ))}
        </div>
    );
};

registerDeviceLayout('builtin-eq', EQLayout);
