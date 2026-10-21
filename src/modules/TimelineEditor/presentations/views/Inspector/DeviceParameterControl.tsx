import { type ReactElement, type ChangeEvent, type DragEvent, useRef, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { TRACK_COLOR_PRESETS } from '#/components/daw/colorPresets';
import { Row, Stack } from '#/components/layout';
import { BipolarSlider } from '#/components/ui/bipolar-slider';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore } from '#/modules/Arrangement/stores';
import { quantiseDeviceParameterValue, setDeviceParameter } from '#/modules/Arrangement/useCases';
import {
    automationStore,
    modulationStore,
    modulationRuntimeStore,
    modulationDragPreviewStore,
    type ModulationStoreState,
} from '#/modules/Automation/stores';
import { addAutomationLane, removeAutomationLane } from '#/modules/Automation/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { MidiLearnButton, MidiLearnRotaryKnob as RotaryKnob } from '#/modules/ControlSurface/presentations/views';
import { createDeviceAutomationTargetId } from '#/utils/automationDeviceTarget';
import { cn } from '#/utils/Styles/cn';

import { type DeviceParameterView as DeviceParameter } from '../../../models/PluginDescriptorViewTypes';
import { type Device } from '../../../models/TrackViewTypes';
import { findEquivalentAutomationLane } from '../../helpers/automationViewHelpers';

type DeviceParameterControlProps = {
    param: DeviceParameter;
    device: Device;
    trackId: string;
};

type DeviceAutomationState = {
    lanes: Array<{
        id: string;
        trackId: string;
        clipId?: string;
        parameterId: string;
    }>;
};

/**
 * Build an O(1) lookup keyed by `trackId|parameterId` so each
 * DeviceParameterControl instance can skip the full `lanes.find()` scan
 * (see audit §115.1). React Compiler memoizes this call on `lanes` identity,
 * so the lookup is rebuilt at most once per automation-store update.
 */
function buildLaneLookup(lanes: DeviceAutomationState['lanes']): Map<string, DeviceAutomationState['lanes'][number]> {
    const map = new Map<string, DeviceAutomationState['lanes'][number]>();
    for (const lane of lanes) {
        if (lane.clipId) {
            continue;
        }
        map.set(`${lane.trackId}|${lane.parameterId}`, lane);
    }
    return map;
}

type ParameterMapping = { modulatorId: string; amount: number };
type ParameterHalo = { id: string; amount: number; color: string; activity: number; preview?: boolean };

const NO_PARAMETER_MAPPINGS: ParameterMapping[] = [];
const NO_ACTIVITIES: number[] = [];

function sourceHash(id: string): number {
    let hash = 2166136261;
    for (const character of id) {
        hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
    return hash >>> 0;
}

function colorForSource(id: string, usedColors: Set<string>): string {
    const first = sourceHash(id) % TRACK_COLOR_PRESETS.length;
    for (let offset = 0; offset < TRACK_COLOR_PRESETS.length; offset += 1) {
        const color = `color-mix(in oklch, ${TRACK_COLOR_PRESETS[(first + offset) % TRACK_COLOR_PRESETS.length]!} 55%, white)`;
        if (!usedColors.has(color)) {
            usedColors.add(color);
            return color;
        }
    }
    // More simultaneous sources than palette entries remain distinguishable.
    const hue = (sourceHash(id) + usedColors.size * 137) % 360;
    const color = `oklch(0.72 0.13 ${hue})`;
    usedColors.add(color);
    return color;
}

/**
 * Pull the mappings that target this exact (trackId, deviceId, paramId) triple out of
 * every enabled modulator. `useDeviceParameterModulation` passes a fresh closure over this
 * function on every render, so the scan itself is not skipped by reference identity — it
 * re-runs each render this hook participates in. What's actually cached is the *result*:
 * `parameterMappingsEqual` (below) keeps the returned array reference stable across renders
 * whose mapping set is unchanged, so the runtime-value selector downstream only sees a "new"
 * mappings input when a mapping genuinely changed, not on every recompute.
 */
function selectParameterMappings(
    state: ModulationStoreState | null,
    trackId: string,
    deviceId: string,
    paramId: string
): ParameterMapping[] {
    let mappings: ParameterMapping[] | undefined;
    for (const mod of state?.modulators ?? []) {
        if (!mod.enabled) {
            continue;
        }
        for (const mapping of mod.mappings) {
            if (
                mapping.targetTrackId === trackId &&
                mapping.targetDeviceId === deviceId &&
                mapping.targetParamId === paramId
            ) {
                mappings ??= [];
                mappings.push({ modulatorId: mod.id, amount: mapping.amount });
            }
        }
    }
    return mappings?.sort((left, right) => left.modulatorId.localeCompare(right.modulatorId)) ?? NO_PARAMETER_MAPPINGS;
}

function parameterMappingsEqual(a: ParameterMapping[], b: ParameterMapping[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    return a.every(
        (mapping, index) => mapping.modulatorId === b[index]!.modulatorId && mapping.amount === b[index]!.amount
    );
}

function selectModulationActivities(
    runtimeState: { runtimeValues: Record<string, number> } | null,
    mappings: ParameterMapping[]
): number[] {
    if (mappings.length === 0) {
        return NO_ACTIVITIES;
    }
    return mappings.map((mapping) => runtimeState?.runtimeValues[mapping.modulatorId] ?? 0);
}

function activitiesEqual(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((activity, index) => Object.is(activity, right[index]));
}

/** Runtime ticks for unrelated sources keep the returned selection unchanged. */
function useDeviceParameterModulation(trackId: string, deviceId: string, paramId: string): ParameterHalo[] {
    const mappings = useStoreSelector(
        modulationStore,
        (state) => selectParameterMappings(state, trackId, deviceId, paramId),
        parameterMappingsEqual
    );

    const activities = useStoreSelector(
        modulationRuntimeStore,
        (state) => selectModulationActivities(state, mappings),
        activitiesEqual
    );
    const usedColors = new Set<string>();
    return mappings.map((mapping, index) => ({
        id: mapping.modulatorId,
        amount: mapping.amount,
        color: colorForSource(mapping.modulatorId, usedColors),
        activity: activities[index] ?? 0,
    }));
}

/** Compute a sensible step from the parameter range and type. */
function deriveStep(param: DeviceParameter): number {
    if (param.type === 'int') {
        return 1;
    }
    const range = param.maxValue - param.minValue;
    // Aim for ~200 discrete positions across the full range
    const raw = range / 200;
    // Snap to a "nice" precision: find the order of magnitude and round
    if (raw >= 1) {
        return Math.max(1, Math.round(raw));
    }
    // For sub-1 steps, round to the nearest power-of-10 fraction
    const mag = 10 ** Math.floor(Math.log10(raw));
    return Math.max(0.001, Math.round(raw / mag) * mag);
}

/** Format display value with appropriate precision. */
function formatDisplayValue(value: number, param: DeviceParameter): string {
    if (param.type === 'int') {
        return String(Math.round(value));
    }
    // Precision follows the step the knob actually moves in, not the declared
    // span. Deriving it from the span made the readout hostage to the floor:
    // widening `phaser-rate` from 0.1 to 0 moved its range 9.9 → 10 and tipped
    // it across a `range >= 10` boundary, so a 0.05 Hz preset value would have
    // rendered as "0.1". The step is 0.05 under either floor, and a control
    // that steps by 0.05 wants two decimals whatever its endpoints are.
    //
    // This does shift 0..1 parameters (step 0.005) from 2 decimals to 3 — a
    // deliberate call: those are the controls whose steps were being rounded
    // away. The cap keeps it at three.
    const step = deriveStep(param);
    return value.toFixed(Math.min(3, Math.max(0, Math.ceil(-Math.log10(step)))));
}

export const DeviceParameterControl = ({ param, device, trackId }: DeviceParameterControlProps): ReactElement => {
    const autoState = useStore<DeviceAutomationState>(automationStore, { lanes: [] });
    const trackState = useStore(trackStore, { tracks: [], selectedTrackId: null });

    const modulations = useDeviceParameterModulation(trackId, device.id, param.id);
    const draggedModulatorId = useStoreSelector(modulationDragPreviewStore, (state) => state?.modulatorId ?? null);
    const draggedSourceEnabled = useStoreSelector(
        modulationStore,
        (state) =>
            state?.modulators.some((modulator) => modulator.id === draggedModulatorId && modulator.enabled) ?? false
    );
    const [hoveredModulatorId, setHoveredModulatorId] = useState<string | null>(null);
    const dropCommittedRef = useRef(false);

    const laneLookup = buildLaneLookup(autoState.lanes);
    const targetId = createDeviceAutomationTargetId(device.id, param.id);
    const devices = trackState.tracks.find((track) => track.id === trackId)?.devices ?? [device];
    const activeLane =
        laneLookup.get(`${trackId}|${targetId}`) ??
        findEquivalentAutomationLane(
            targetId,
            autoState.lanes.filter((lane) => lane.trackId === trackId && !lane.clipId),
            devices
        );
    const hasAutomation = !!activeLane;

    const value = device.parameterValues[param.id] ?? param.value;
    const step = deriveStep(param);
    const fineStep = step / 10;
    const displayValue = formatDisplayValue(value, param);

    const handleKnobChange = (value1: number) => {
        setDeviceParameter(device.id, param.id, value1);
    };

    // Shared by both select branches, which put different numbers in `value`:
    // a `choice` option carries its index, a legal-set option carries the
    // setting itself. Either way what the option carries is what gets written.
    const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
        setDeviceParameter(device.id, param.id, Number(event.target.value));
    };

    const isChoice = param.type === 'choice' && param.choices && param.choices.length > 0;

    // A parameter that declares a legal set is offered as that set and nothing
    // between. A knob would step by 1 over the declared span
    // (`deriveStep`), and for `crust/oversampling` that is 32 positions the
    // engine resolves to 6 — 26 drags that move the readout and render an
    // identical signal.
    const legalValues = param.legalSet?.values;
    const isLegalSet = !!legalValues && legalValues.length > 0;
    const isDiscrete = isChoice || isLegalSet;

    const isSlider = param.unit === 'dB';
    const isLog = param.scaling === 'log';
    const canPreview =
        draggedModulatorId !== null &&
        draggedSourceEnabled &&
        param.automatable &&
        !isDiscrete &&
        !isSlider &&
        !modulations.some((modulation) => modulation.id === draggedModulatorId);
    const isPreviewing = canPreview && hoveredModulatorId === draggedModulatorId;
    const previewColor =
        isPreviewing && draggedModulatorId
            ? colorForSource(draggedModulatorId, new Set(modulations.map((modulation) => modulation.color)))
            : null;
    const displayedModulations =
        isPreviewing && draggedModulatorId && previewColor
            ? [
                  ...modulations,
                  {
                      id: draggedModulatorId,
                      amount: 0.5,
                      activity: 0,
                      color: previewColor,
                      preview: true,
                  },
              ]
            : modulations;

    const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
        if (!canPreview) {
            return;
        }
        event.preventDefault();
        dropCommittedRef.current = false;
        setHoveredModulatorId(draggedModulatorId);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
        if (!canPreview) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
        }
        setHoveredModulatorId(null);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        if (draggedModulatorId === null || !canPreview || !isPreviewing || dropCommittedRef.current) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        dropCommittedRef.current = true;
        setHoveredModulatorId(null);
        void executeUserAppAction({
            type: 'addMapping',
            payload: {
                modulatorId: draggedModulatorId,
                mapping: {
                    targetTrackId: trackId,
                    targetDeviceId: device.id,
                    targetParamId: param.id,
                    amount: 0.5,
                },
            },
        });
    };

    const renderSliderOrKnob = () => {
        if (isLegalSet) {
            return (
                <DawCompactSelect
                    className="w-[80px] bg-surface px-1.5 focus-visible:ring-primary"
                    // Shown at the member actually in force, not the raw stored
                    // number: a project saved before the set was declared, or a
                    // MIDI CC scaled across the range, can hold a value between
                    // two members, and the select would otherwise show the wrong
                    // one while the engine ran another. Asked of the delivery
                    // law rather than resolved here — a control that works out
                    // "which member is this" for itself is how the readout and
                    // the DSP come to disagree again.
                    value={quantiseDeviceParameterValue({
                        deviceType: device.type,
                        paramId: param.id,
                        value,
                    })}
                    onChange={handleSelectChange}
                    aria-label={param.name}
                >
                    {legalValues.map((legal) => (
                        <option key={legal} value={legal}>
                            {`${legal}${param.unit}`}
                        </option>
                    ))}
                </DawCompactSelect>
            );
        }

        if (isChoice) {
            return (
                <DawCompactSelect
                    className="w-[80px] bg-surface px-1.5 focus-visible:ring-primary"
                    value={Math.round(value)}
                    onChange={handleSelectChange}
                    aria-label={param.name}
                >
                    {param.choices!.map((label, index) => (
                        <option key={label} value={index}>
                            {label}
                        </option>
                    ))}
                </DawCompactSelect>
            );
        }

        // The control spans exactly the range a write is held to. It must not
        // narrow it: `RotaryKnob` clamps to `min`, so a tighter floor here
        // would rewrite any stored value below it on the first drag, one-way.
        const min = isLog ? 0 : param.minValue;
        const max = isLog ? 1 : param.maxValue;
        const mappedStep = isLog ? 0.001 : step;
        const mappedFineStep = isLog ? 0.0001 : fineStep;

        const logFloor = param.minValue || 0.001;
        const toLinear = (logVal: number) => {
            const clampVal = Math.max(logFloor, Math.min(param.maxValue, logVal));
            return Math.log(clampVal / logFloor) / Math.log(param.maxValue / logFloor);
        };
        const toLog = (linearVal: number) => {
            return logFloor * (param.maxValue / logFloor) ** linearVal;
        };

        const mappedValue = isLog ? toLinear(value) : value;
        const mappedDefaultValue = isLog
            ? toLinear(param.defaultValue ?? param.value)
            : (param.defaultValue ?? param.value);

        const onChange = (value1: number) => {
            handleKnobChange(isLog ? toLog(value1) : value1);
        };

        if (isSlider) {
            return (
                <BipolarSlider
                    value={mappedValue}
                    onValueChange={onChange}
                    min={min}
                    max={max}
                    step={mappedStep}
                    defaultValue={mappedDefaultValue}
                    aria-label={param.name}
                    formatValue={(value1) => `${formatDisplayValue(isLog ? toLog(value1) : value1, param)} dB`}
                    className="w-full"
                />
            );
        }

        return (
            <div
                role="region"
                aria-label={`Modulation target for ${param.name}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <RotaryKnob
                    paramId={param.id}
                    targetType="deviceParam"
                    trackId={trackId}
                    deviceId={device.id}
                    value={mappedValue}
                    onChange={onChange}
                    min={min}
                    max={max}
                    step={mappedStep}
                    fineStep={mappedFineStep}
                    defaultValue={mappedDefaultValue}
                    aria-label={param.name}
                    bipolar={!isLog && param.minValue < 0 && param.maxValue > 0}
                    modulations={displayedModulations.length > 0 ? displayedModulations : undefined}
                    size={
                        param.name.toLowerCase().includes('mix') ||
                        param.name.toLowerCase().includes('dry/wet') ||
                        param.name.toLowerCase().includes('threshold') ||
                        param.name.toLowerCase().includes('time') ||
                        param.name.toLowerCase().includes('rate')
                            ? 'xl'
                            : 'lg'
                    }
                />
            </div>
        );
    };

    return (
        <div className={cn('flex w-full min-w-0', isSlider ? 'flex-col gap-2' : 'flex-row items-center gap-3')}>
            {isSlider ? (
                <Row justify="between" className="w-full">
                    <label className="text-[10px] font-medium text-foreground truncate" title={param.name}>
                        {param.name}
                    </label>
                    <Row gap={1.5} className="mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {displayValue}
                            {param.unit ? ` ${param.unit}` : ''}
                        </span>
                        <MidiLearnButton
                            targetType="deviceParam"
                            trackId={trackId}
                            deviceId={device.id}
                            paramId={param.id}
                        />
                        {param.automatable ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        type="button"
                                        className={cn(
                                            'size-3 rounded-full border shrink-0 transition-colors cursor-pointer',
                                            hasAutomation
                                                ? 'border-[var(--color-accent-peach)] bg-[var(--color-accent-peach)]/20'
                                                : 'border-muted-foreground/30 hover:bg-muted'
                                        )}
                                        onClick={() => {
                                            if (activeLane) {
                                                removeAutomationLane(activeLane.id);
                                            } else {
                                                addAutomationLane(trackId, targetId, param.name);
                                            }
                                        }}
                                        aria-label={
                                            hasAutomation
                                                ? `Remove automation for ${param.name}`
                                                : `Automate ${param.name}`
                                        }
                                        aria-pressed={hasAutomation}
                                    />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {hasAutomation ? 'Remove automation lane' : 'Add automation lane'}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </Row>
                </Row>
            ) : (
                <Stack justify="center" grow gap={1.5} className="min-w-0 overflow-hidden">
                    <label className="text-[10px] font-medium text-foreground truncate w-full" title={param.name}>
                        {param.name}
                    </label>
                    {!isDiscrete ? (
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {displayValue}
                            {param.unit ? ` ${param.unit}` : ''}
                        </span>
                    ) : null}
                    <Row gap={1.5} className="mt-0.5">
                        <MidiLearnButton
                            targetType="deviceParam"
                            trackId={trackId}
                            deviceId={device.id}
                            paramId={param.id}
                        />
                        {param.automatable ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="bare"
                                        size="bare"
                                        type="button"
                                        className={cn(
                                            'size-3 rounded-full border shrink-0 transition-colors cursor-pointer',
                                            hasAutomation
                                                ? 'border-[var(--color-accent-peach)] bg-[var(--color-accent-peach)]/20'
                                                : 'border-muted-foreground/30 hover:bg-muted'
                                        )}
                                        onClick={() => {
                                            if (activeLane) {
                                                removeAutomationLane(activeLane.id);
                                            } else {
                                                addAutomationLane(trackId, targetId, param.name);
                                            }
                                        }}
                                        aria-label={
                                            hasAutomation
                                                ? `Remove automation for ${param.name}`
                                                : `Automate ${param.name}`
                                        }
                                        aria-pressed={hasAutomation}
                                    />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {hasAutomation ? 'Remove automation lane' : 'Add automation lane'}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </Row>
                </Stack>
            )}

            <div className={cn('flex items-center justify-center', isSlider ? 'w-full px-1' : 'shrink-0')}>
                {renderSliderOrKnob()}
            </div>
        </div>
    );
};
