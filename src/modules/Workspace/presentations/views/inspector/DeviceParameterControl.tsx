import { type ReactElement, useSyncExternalStore } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { BipolarSlider } from '#/components/ui/bipolar-slider';
import { cn } from '#/helpers/Styles/cn';
import { MidiLearnButton } from '#/modules/Track/presentations/views/MidiLearnButton';
import { type DeviceParameter } from '../../../useCases/workspaceViewActions';
import { addAutomationLane, removeAutomationLane } from '../../../useCases/workspaceViewActions';
import { setDeviceParameter } from '../../../useCases/workspaceViewActions';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { type Device } from '../../../useCases/workspaceViewActions';

type DeviceParameterControlProps = {
    param: DeviceParameter;
    device: Device;
    trackId: string;
};

export const DeviceParameterControl = ({ param, device, trackId }: DeviceParameterControlProps): ReactElement => {
    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(cb),
        () => automationStore.value
    );

    const activeLane = autoState?.lanes.find((l) => l.trackId === trackId && l.parameterId === param.id);
    const hasAutomation = !!activeLane;

    const value = device.parameterValues[param.id] ?? param.value;

    const handleKnobChange = (v: number) => {
        setDeviceParameter(device.id, param.id, v);
    };

    const handleChoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setDeviceParameter(device.id, param.id, Number(e.target.value));
    };

    const isChoice = param.type === 'choice' && param.choices && param.choices.length > 0;

    const isSlider = param.unit === 'dB';

    return (
        <div className={cn('flex w-full min-w-0', isSlider ? 'flex-col gap-2' : 'flex-row items-center gap-3')}>
            {isSlider ? (
                <div className="flex items-center justify-between w-full">
                    <label className="text-[10px] font-medium text-foreground truncate" title={param.name}>
                        {param.name}
                    </label>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {value.toFixed(param.type === 'int' ? 0 : 1)}
                            {param.unit ? ` ${param.unit}` : ''}
                        </span>
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
                                    'size-3 rounded-full border shrink-0 transition-colors cursor-pointer',
                                    hasAutomation
                                        ? 'border-orange-400 bg-orange-400/20'
                                        : 'border-muted-foreground/30 hover:bg-muted'
                                )}
                                onClick={() => {
                                    if (activeLane) {
                                        removeAutomationLane(activeLane.id);
                                    } else {
                                        addAutomationLane(trackId, param.id, param.name);
                                    }
                                }}
                                aria-label={`Automate ${param.name}`}
                                title={hasAutomation ? 'Remove automation lane' : 'Add automation lane'}
                            />
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col flex-1 min-w-0 overflow-hidden justify-center gap-1.5">
                    <label className="text-[10px] font-medium text-foreground truncate w-full" title={param.name}>
                        {param.name}
                    </label>
                    {!isChoice && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {value.toFixed(param.type === 'int' ? 0 : 1)}
                            {param.unit ? ` ${param.unit}` : ''}
                        </span>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
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
                                    'size-3 rounded-full border shrink-0 transition-colors cursor-pointer',
                                    hasAutomation
                                        ? 'border-orange-400 bg-orange-400/20'
                                        : 'border-muted-foreground/30 hover:bg-muted'
                                )}
                                onClick={() => {
                                    if (activeLane) {
                                        removeAutomationLane(activeLane.id);
                                    } else {
                                        addAutomationLane(trackId, param.id, param.name);
                                    }
                                }}
                                aria-label={`Automate ${param.name}`}
                                title={hasAutomation ? 'Remove automation lane' : 'Add automation lane'}
                            />
                        )}
                    </div>
                </div>
            )}

            <div className={cn('flex items-center justify-center', isSlider ? 'w-full px-1' : 'shrink-0')}>
                {isChoice ? (
                    <select
                        className="w-[80px] rounded bg-surface px-1.5 py-1 text-xs text-foreground border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary"
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
                ) : isSlider ? (
                    <BipolarSlider
                        value={value}
                        onValueChange={handleKnobChange}
                        min={param.minValue}
                        max={param.maxValue}
                        step={param.type === 'int' ? 1 : 0.1}
                        defaultValue={param.defaultValue ?? param.value}
                        formatValue={(v) => `${v.toFixed(1)} dB`}
                        className="w-full"
                    />
                ) : (
                    <RotaryKnob
                        value={value}
                        onChange={handleKnobChange}
                        min={param.minValue}
                        max={param.maxValue}
                        step={param.type === 'int' ? 1 : undefined}
                        defaultValue={param.defaultValue ?? param.value}
                        bipolar={param.minValue < 0 && param.maxValue > 0}
                        size={
                            param.name.toLowerCase().includes('mix') ||
                            param.name.toLowerCase().includes('dry/wet') ||
                            param.name.toLowerCase().includes('threshold') ||
                            param.name.toLowerCase().includes('time') ||
                            param.name.toLowerCase().includes('rate')
                                ? 64
                                : 48
                        }
                    />
                )}
            </div>
        </div>
    );
};
