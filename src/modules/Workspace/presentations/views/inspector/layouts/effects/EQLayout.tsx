import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import {
    type DeviceLayoutProps,
    SectionHeader,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { DeviceParameterControl } from '../../DeviceParameterControl';
import { EQCurve } from '../../../../components/EQCurve';

const EQLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    return (
        <div className="space-y-3">
            <div>
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
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="EQ Graphic" />
                <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
                    {(['Low', 'Mid', 'High'] as const).map((band) => (
                        <Card key={band} className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">{band}</span>
                            <div className="w-full space-y-4">
                                {parameters
                                    .filter((p) => p.name.includes(band))
                                    .map((param) => (
                                        <DeviceParameterControl key={param.id} param={param} device={device} trackId={trackId} />
                                    ))}
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-eq'], EQLayout);
