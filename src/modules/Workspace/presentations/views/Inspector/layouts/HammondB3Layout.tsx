import { type ReactElement } from 'react';
import { registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';

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
                                    <input
                                        type="range"
                                        min={p.minValue}
                                        max={p.maxValue}
                                        step="1"
                                        value={8 - val}
                                        onChange={(e) => {
                                            setDeviceParameter(device.id, p.id, 8 - Number(e.target.value));
                                        }}
                                        className="absolute top-1/2 left-1/2 w-[120px] h-6 cursor-pointer m-0"
                                        style={{
                                            transform: 'translate(-50%, -50%) rotate(270deg)',
                                            WebkitAppearance: 'slider-horizontal',
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
                            <DeviceParameterControl key={p.id} param={p} device={device} trackId={trackId} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

registerDeviceLayout('faust-hammond-b3', HammondB3Layout);
