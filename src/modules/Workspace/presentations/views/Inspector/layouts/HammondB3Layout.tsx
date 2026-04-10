import { type ReactElement } from 'react';
import { Slider } from '#/components/ui/slider';
import { registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { setDeviceParameter } from '#/modules/Arrangement';
import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';

export const HammondB3Layout = ({ device, trackId }: any): ReactElement | null => {
    if (!device) return null;

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

    const drawbarParams = drawbars.map((id) => device.parameters.find((p: any) => p.id === id)).filter(Boolean);

    const otherParams = device.parameters.filter((p: any) => !drawbars.includes(p.id));

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-foreground/80 uppercase px-1">Drawbars</h3>
                <div className="flex flex-row justify-between bg-surface-raised p-4 rounded-md border border-border/50">
                    {drawbarParams.map((p: any) => {
                        const val = device.parameterValues[p.id] ?? p.value;
                        return (
                            <div key={p.id} className="flex flex-col items-center gap-2">
                                <div className="h-[120px] relative w-6">
                                    <Slider
                                        orientation="vertical"
                                        min={p.minValue}
                                        max={p.maxValue}
                                        step={1}
                                        value={[8 - val]}
                                        className="h-[120px] w-6"
                                        trackClassName="w-2 rounded-sm bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
                                        rangeClassName="[background:linear-gradient(180deg,rgba(201,160,122,0.92)_0%,rgba(201,160,122,0.6)_100%)] shadow-[0_0_10px_rgba(201,160,122,0.14)]"
                                        thumbClassName="size-5 rounded-[4px]"
                                        aria-label={p.name}
                                        onValueChange={(values) => {
                                            const nextValue = values[0];
                                            if (nextValue !== undefined) {
                                                setDeviceParameter(device.id, p.id, 8 - nextValue);
                                            }
                                        }}
                                    />
                                </div>
                                <span className="text-[10px] font-mono font-medium text-foreground/60">
                                    {p.name.split(' ')[0]}
                                </span>
                                <span className="text-[10px] font-mono text-foreground/80">{Math.round(val)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {otherParams.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border/40 pt-4">
                    <h3 className="text-xs font-semibold text-foreground/80 uppercase px-1">Controls</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {otherParams.map((p: any) => (
                            <SurfaceCard key={p.id} className="p-2">
                                <DeviceParameterControl param={p} device={device} trackId={trackId} />
                            </SurfaceCard>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

registerDeviceLayout('faust-hammond-b3', HammondB3Layout);
