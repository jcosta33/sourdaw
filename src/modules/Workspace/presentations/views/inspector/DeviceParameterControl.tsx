import { type ReactElement, useSyncExternalStore } from 'react';
import { Knob } from '#/components/ui/knob';
import { BipolarSlider } from '#/components/ui/bipolar-slider';
import { cn } from '#/helpers/Styles/cn';
import { MidiLearnButton } from '#/modules/Track/presentations/views/MidiLearnButton';
import { type DeviceParameter } from '../../../useCases/workspaceViewActions';
import { addAutomationLane } from '../../../useCases/workspaceViewActions';
import { setDeviceParameter } from '../../../useCases/workspaceViewActions';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { type Device } from '../../../useCases/workspaceViewActions';

export type DeviceParameterControlProps = {
    param: DeviceParameter;
    device: Device;
    trackId: string;
};

export const DeviceParameterControl = ({ param, device, trackId }: DeviceParameterControlProps): ReactElement => {
    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(cb),
        () => automationStore.value
    );

    const hasAutomation = autoState?.lanes.some((l) => l.trackId === trackId && l.parameterId === param.id) ?? false;

    const value = device.parameterValues[param.id] ?? param.value;

    const handleKnobChange = (v: number) => {
        setDeviceParameter(device.id, param.id, v);
    };

    const handleChoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setDeviceParameter(device.id, param.id, Number(e.target.value));
    };

    const isChoice = param.type === 'choice' && param.choices && param.choices.length > 0;

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-muted-foreground">{param.name}</label>
                <div className="flex items-center gap-1">
                    {!isChoice && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {value.toFixed(param.type === 'int' ? 0 : 1)}
                            {param.unit ? ` ${param.unit}` : ''}
                        </span>
                    )}
                    <MidiLearnButton
                        targetType="deviceParam"
                        trackId={trackId}
                        deviceId={device.id}
                        paramId={param.id}
                    />
                    {param.automatable && (
                        <button
                            type="button"
                            className={cn(
                                'size-3 rounded-full border',
                                hasAutomation ? 'border-orange-400 bg-orange-400/20' : 'border-muted-foreground/30'
                            )}
                            onClick={() => addAutomationLane(trackId, param.id, param.name)}
                            aria-label={`Automate ${param.name}`}
                            title={hasAutomation ? 'Automation active' : 'Add automation lane'}
                        />
                    )}
                </div>
            </div>
            {isChoice ? (
                <select
                    className="w-full rounded bg-surface px-2 py-1 text-xs text-foreground border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    value={Math.round(value)}
                    onChange={handleChoiceChange}
                    aria-label={param.name}
                >
                    {param.choices!.map((label, i) => (
                        <option key={label} value={i}>
                            {label}
                        </option>
                    ))}
                </select>
            ) : (
                <div className="flex justify-center mt-3 pb-1 w-full px-1">
                    {param.unit === 'dB' ? (
                        <BipolarSlider
                            value={value}
                            onValueChange={handleKnobChange}
                            min={param.minValue}
                            max={param.maxValue}
                            step={param.type === 'int' ? 1 : 0.1}
                            defaultValue={param.defaultValue ?? param.value}
                            formatValue={(v) => `${v.toFixed(1)} dB`}
                        />
                    ) : (
                        <Knob
                            value={value}
                            onValueChange={handleKnobChange}
                            min={param.minValue}
                            max={param.maxValue}
                            step={param.type === 'int' ? 1 : 0}
                            defaultValue={param.defaultValue ?? param.value}
                            size={
                                param.name.toLowerCase().includes('mix') ||
                                param.name.toLowerCase().includes('dry/wet') ||
                                param.name.toLowerCase().includes('threshold') ||
                                param.name.toLowerCase().includes('time') ||
                                param.name.toLowerCase().includes('rate')
                                    ? 64
                                    : 48
                            }
                            aria-label={param.name}
                        />
                    )}
                </div>
            )}
        </div>
    );
};
