import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';

export const HammondB3Layout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement | null => {
    if (!device) {
        return null;
    }

    const drawbars = [
        'drawbar_16',
        'drawbar_513',
        'drawbar_8',
        'drawbar_4',
        'drawbar_223',
        'drawbar_2',
        'drawbar_135',
        'drawbar_113',
        'drawbar_1',
    ];

    const drawbarParams = drawbars
        .map((id) => parameters.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

    const otherParams = parameters.filter((param) => !drawbars.includes(param.id));

    return (
        <Stack gap={6}>
            <Stack gap={2}>
                <h3 className="text-xs font-semibold text-foreground/80 uppercase px-1">Drawbars</h3>
                <Row
                    align="stretch"
                    justify="between"
                    className="bg-surface-raised p-4 rounded-md border border-border/50"
                >
                    {drawbarParams.map((param) => {
                        const val = device.parameterValues[param.id] ?? param.value;
                        return (
                            <Stack align="center" gap={2} key={param.id}>
                                <div className="h-[120px] relative w-6">
                                    <Slider
                                        orientation="vertical"
                                        min={param.minValue}
                                        max={param.maxValue}
                                        step={1}
                                        value={[8 - val]}
                                        className="h-[120px] w-6"
                                        trackClassName="w-2 rounded-sm bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
                                        rangeClassName="[background:linear-gradient(180deg,rgba(201,160,122,0.92)_0%,rgba(201,160,122,0.6)_100%)] shadow-[0_0_10px_rgba(201,160,122,0.14)]"
                                        thumbClassName="size-5 rounded-[4px]"
                                        aria-label={param.name}
                                        onValueChange={(values) => {
                                            const nextValue = values[0];
                                            if (nextValue !== undefined) {
                                                setDeviceParameter(device.id, param.id, 8 - nextValue);
                                            }
                                        }}
                                    />
                                </div>
                                <span className="text-[10px] font-mono font-medium text-foreground/60">
                                    {param.name.split(' ')[0]}
                                </span>
                                <span className="text-[10px] font-mono text-foreground/80">{Math.round(val)}</span>
                            </Stack>
                        );
                    })}
                </Row>
            </Stack>
            {otherParams.length > 0 ? (
                <Stack gap={2} className="border-t border-border/40 pt-4">
                    <h3 className="text-xs font-semibold text-foreground/80 uppercase px-1">Controls</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {otherParams.map((param) => (
                            <SurfaceCard key={param.id} className="p-2">
                                <DeviceParameterControl param={param} device={device} trackId={trackId} />
                            </SurfaceCard>
                        ))}
                    </div>
                </Stack>
            ) : null}
        </Stack>
    );
};

registerDeviceLayout('faust-hammond-b3', HammondB3Layout);
