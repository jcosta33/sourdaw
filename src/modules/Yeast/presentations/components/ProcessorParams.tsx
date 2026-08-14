/**
 * ProcessorParams — renders parameter controls for a specific Yeast processor.
 * Each processor type gets its own set of knobs/selectors based on its parameters.
 */
import { type ReactElement } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';

import { type ProcessorType } from '../../models/ProcessorCatalog';

import type { ChordMemoryCommand } from '../../models/YeastProcessorCommand';

type OnSetParam = (id: string, name: string, value: number, isTransient?: boolean) => void;
type OnCommand = (id: string, command: ChordMemoryCommand) => Promise<unknown> | void;
type GrooveTemplateOption = { id: string; name: string };

type Props = {
    processorId: string;
    processorType: ProcessorType;
    /** Live per-parameter values from yeastStore; each control falls back to its compiled default when absent. */
    params?: Record<string, number>;
    onSetParam: OnSetParam;
    onCommand: OnCommand;
    grooveTemplates?: readonly GrooveTemplateOption[];
    selectedGrooveTemplateId?: string;
    grooveAmount?: number;
    onSetGrooveTemplate?: (processorId: string, templateId: string) => Promise<unknown> | void;
};

const K = ({
    id,
    name,
    label,
    value,
    min,
    max,
    step,
    unit,
    onSetParam,
}: {
    id: string;
    name: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    onSetParam: OnSetParam;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob
            value={value}
            onChange={(nextValue, isTransient) => onSetParam(id, name, nextValue, isTransient)}
            min={min}
            max={max}
            step={step}
            defaultValue={value}
            size="sm"
            tone="rose"
            aria-label={label}
        />
        <span className="text-[6px] text-muted-foreground leading-none">{label}</span>
        {unit ? (
            <span className="text-[5px] text-muted-foreground/40 font-mono">
                {value.toFixed(step < 1 ? 2 : 0)}
                {unit}
            </span>
        ) : null}
    </div>
);

const Sel = ({
    id,
    name,
    label,
    options,
    value,
    onSetParam,
}: {
    id: string;
    name: string;
    label: string;
    options: string[];
    value: number;
    onSetParam: OnSetParam;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0.5">
        <select
            className="h-4 text-[6px] bg-surface-inset border border-border/30 rounded px-0.5 text-foreground cursor-pointer"
            value={value}
            onChange={(event) => onSetParam(id, name, parseInt(event.target.value))}
        >
            {options.map((opt, index) => (
                <option key={opt} value={index}>
                    {opt}
                </option>
            ))}
        </select>
        <span className="text-[6px] text-muted-foreground">{label}</span>
    </div>
);

export const ProcessorParams = ({
    processorId: pid,
    processorType,
    params = {},
    onSetParam,
    onCommand,
    grooveTemplates = [],
    selectedGrooveTemplateId = '',
    grooveAmount = 0.5,
    onSetGrooveTemplate,
}: Props): ReactElement | null => {
    const handleCommand = (command: ChordMemoryCommand): void => {
        const result = onCommand(pid, command);
        if (result) {
            void result.catch(() => undefined);
        }
    };

    switch (processorType) {
        case 'arpeggiator':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="mode"
                        label="Mode"
                        options={['Up', 'Down', 'Up-Down', 'Down-Up', 'Random', 'Order', 'Chord', 'Pattern']}
                        value={params?.['mode'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rate_denom"
                        label="Rate"
                        value={params?.['rate_denom'] ?? 8}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="gate"
                        label="Gate"
                        value={params?.['gate'] ?? 0.8}
                        min={0.01}
                        max={2}
                        step={0.01}
                        unit=""
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="swing"
                        label="Swing"
                        value={params?.['swing'] ?? 0}
                        min={0}
                        max={1}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="octave_range"
                        label="Octaves"
                        value={params?.['octave_range'] ?? 1}
                        min={1}
                        max={4}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="octave_direction"
                        label="Oct Dir"
                        options={['Up', 'Down', 'Up-Down']}
                        value={params?.['octave_direction'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="velocity_mode"
                        label="Vel Mode"
                        options={['Input', 'Fixed', 'Random']}
                        value={params?.['velocity_mode'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="fixed_velocity"
                        label="Fixed Vel"
                        value={params?.['fixed_velocity'] ?? 100}
                        min={1}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="restart_mode"
                        label="Restart"
                        options={['Free', 'On Note', 'On Bar']}
                        value={params?.['restart_mode'] ?? 1}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'chord':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="chord_type"
                        label="Chord"
                        options={[
                            'Major',
                            'Minor',
                            'Dim',
                            'Aug',
                            'Sus2',
                            'Sus4',
                            'Dom7',
                            'Maj7',
                            'Min7',
                            'Dim7',
                            '9th',
                            '11th',
                        ]}
                        value={params?.['chord_type'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="voicing"
                        label="Voicing"
                        options={['Close', 'Drop 2', 'Drop 3', 'Spread']}
                        value={params?.['voicing'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="strum_ms"
                        label="Strum"
                        value={params?.['strum_ms'] ?? 0}
                        min={0}
                        max={100}
                        step={1}
                        unit="ms"
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="strum_direction"
                        label="Strum Dir"
                        options={['Up', 'Down']}
                        value={params?.['strum_direction'] ?? 0}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'chordMemory':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <button
                        type="button"
                        className="px-2 py-1 text-[7px] rounded border border-border/30 cursor-pointer hover:text-foreground text-muted-foreground"
                        onClick={() => handleCommand('learn')}
                    >
                        Learn
                    </button>
                    <Sel
                        id={pid}
                        name="transpose_mode"
                        label="Transpose"
                        options={['Off', 'On']}
                        value={params?.['transpose_mode'] ?? 1}
                        onSetParam={onSetParam}
                    />
                    <button
                        type="button"
                        className="px-2 py-1 text-[7px] rounded border border-[var(--color-state-danger)]/30 cursor-pointer text-muted-foreground hover:text-[var(--color-state-danger)]"
                        onClick={() => handleCommand('clear')}
                    >
                        Clear All
                    </button>
                </div>
            );

        case 'scale':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="root"
                        label="Root"
                        options={['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']}
                        value={params?.['root'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="scale"
                        label="Scale"
                        options={[
                            'Major',
                            'Minor',
                            'Harm Min',
                            'Mel Min',
                            'Dorian',
                            'Phrygian',
                            'Lydian',
                            'Mixolyd.',
                            'Pent Maj',
                            'Pent Min',
                            'Blues',
                            'Whole',
                            'Dimin.',
                            'Chromatic',
                        ]}
                        value={params?.['scale'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="remap_mode"
                        label="Remap"
                        options={['Nearest', 'Up', 'Down']}
                        value={params?.['remap_mode'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="transpose"
                        label="Transpose"
                        value={params?.['transpose'] ?? 0}
                        min={-7}
                        max={7}
                        step={1}
                        unit="deg"
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'harmonizer':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="root"
                        label="Root"
                        options={['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']}
                        value={params?.['root'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="scale"
                        label="Scale"
                        options={['Major', 'Minor', 'Dorian', 'Mixolyd.', 'Pent.', 'Chromatic']}
                        value={params?.['scale'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="voice0_degrees"
                        label="Voice 1"
                        value={params?.['voice0_degrees'] ?? 2}
                        min={-7}
                        max={7}
                        step={1}
                        unit="deg"
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="voice0_enabled"
                        label="V1"
                        options={['Off', 'On']}
                        value={params?.['voice0_enabled'] ?? 1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="voice1_degrees"
                        label="Voice 2"
                        value={params?.['voice1_degrees'] ?? 4}
                        min={-7}
                        max={7}
                        step={1}
                        unit="deg"
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="voice1_enabled"
                        label="V2"
                        options={['Off', 'On']}
                        value={params?.['voice1_enabled'] ?? 0}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'repeater':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="repeat_count"
                        label="Repeats"
                        value={params?.['repeat_count'] ?? 3}
                        min={1}
                        max={16}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rate_denom"
                        label="Rate"
                        value={params?.['rate_denom'] ?? 16}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="decay"
                        label="Decay"
                        value={params?.['decay'] ?? 0.7}
                        min={0}
                        max={1}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="gate"
                        label="Gate"
                        value={params?.['gate'] ?? 0.5}
                        min={0.01}
                        max={2}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="pitch_step"
                        label="Pitch"
                        value={params?.['pitch_step'] ?? 0}
                        min={-12}
                        max={12}
                        step={1}
                        unit="st"
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'velocity':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="mode"
                        label="Mode"
                        options={['Pass', 'Fixed', 'Compress', 'Expand', 'Curve', 'Random']}
                        value={params?.['mode'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="fixed_vel"
                        label="Fixed"
                        value={params?.['fixed_vel'] ?? 100}
                        min={1}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="compress_amount"
                        label="Amount"
                        value={params?.['compress_amount'] ?? 0.5}
                        min={0}
                        max={3}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="curve"
                        label="Curve"
                        options={['Linear', 'Soft', 'Hard', 'S-Curve']}
                        value={params?.['curve'] ?? 0}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'humanizer':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <Sel
                        id={pid}
                        name="preset"
                        label="Feel"
                        options={['Tight', 'Loose', 'Drunk', 'Rushed', 'Laid Back']}
                        value={params?.['preset'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="timing_sigma_ms"
                        label="Time Jitter"
                        value={params?.['timing_sigma_ms'] ?? 5}
                        min={0}
                        max={30}
                        step={0.5}
                        unit="ms"
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="vel_sigma"
                        label="Vel Jitter"
                        value={params?.['vel_sigma'] ?? 8}
                        min={0}
                        max={30}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="timing_mean_ms"
                        label="Offset"
                        value={params?.['timing_mean_ms'] ?? 0}
                        min={-30}
                        max={30}
                        step={0.5}
                        unit="ms"
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'filter':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="note_min"
                        label="Low"
                        value={params?.['note_min'] ?? 0}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="note_max"
                        label="High"
                        value={params?.['note_max'] ?? 127}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="vel_min"
                        label="Vel Min"
                        value={params?.['vel_min'] ?? 0}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="vel_max"
                        label="Vel Max"
                        value={params?.['vel_max'] ?? 127}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="invert"
                        label="Invert"
                        options={['Off', 'On']}
                        value={params?.['invert'] ?? 0}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'transposer':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="semitones"
                        label="Semi"
                        value={params?.['semitones'] ?? 0}
                        min={-12}
                        max={12}
                        step={1}
                        unit="st"
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="octaves"
                        label="Oct"
                        value={params?.['octaves'] ?? 0}
                        min={-3}
                        max={3}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="random_range"
                        label="Random"
                        value={params?.['random_range'] ?? 0}
                        min={0}
                        max={12}
                        step={1}
                        unit="st"
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'groove':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <label className="flex flex-col items-center gap-0.5 text-[6px] text-muted-foreground">
                        <select
                            aria-label="Groove template"
                            className="h-4 rounded border border-border/30 bg-surface-inset px-0.5 text-[6px] text-foreground"
                            value={selectedGrooveTemplateId}
                            onChange={(event) => {
                                const result = onSetGrooveTemplate?.(pid, event.target.value);
                                if (result) {
                                    void result.catch(() => undefined);
                                }
                            }}
                        >
                            {grooveTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                    {template.name}
                                </option>
                            ))}
                        </select>
                        Template
                    </label>
                    <K
                        id={pid}
                        name="amount"
                        label="Amount"
                        value={grooveAmount}
                        min={0}
                        max={1}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'ccGenerator':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="cc_number"
                        label="CC #"
                        value={params?.['cc_number'] ?? 1}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <Sel
                        id={pid}
                        name="shape"
                        label="Shape"
                        options={['Sine', 'Tri', 'Square', 'Saw↑', 'Saw↓', 'S&H']}
                        value={params?.['shape'] ?? 0}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rate_denom"
                        label="Rate"
                        value={params?.['rate_denom'] ?? 4}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K id={pid} name="min" label="Min" value={0} min={0} max={127} step={1} onSetParam={onSetParam} />
                    <K id={pid} name="max" label="Max" value={127} min={0} max={127} step={1} onSetParam={onSetParam} />
                    <Sel
                        id={pid}
                        name="retrigger"
                        label="Retrig"
                        options={['Off', 'On']}
                        value={params?.['retrigger'] ?? 0}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'euclidean':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K id={pid} name="hits" label="Hits" value={5} min={0} max={32} step={1} onSetParam={onSetParam} />
                    <K
                        id={pid}
                        name="steps"
                        label="Steps"
                        value={params?.['steps'] ?? 8}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rotation"
                        label="Rotate"
                        value={params?.['rotation'] ?? 0}
                        min={0}
                        max={31}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rate_denom"
                        label="Rate"
                        value={params?.['rate_denom'] ?? 16}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="gate"
                        label="Gate"
                        value={params?.['gate'] ?? 0.5}
                        min={0.01}
                        max={2}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="note"
                        label="Note"
                        value={params?.['note'] ?? 60}
                        min={0}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="velocity"
                        label="Vel"
                        value={params?.['velocity'] ?? 100}
                        min={1}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        case 'markov':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="rate_denom"
                        label="Rate"
                        value={params?.['rate_denom'] ?? 8}
                        min={1}
                        max={32}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="gate"
                        label="Gate"
                        value={params?.['gate'] ?? 0.7}
                        min={0.01}
                        max={2}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="velocity"
                        label="Vel"
                        value={params?.['velocity'] ?? 100}
                        min={1}
                        max={127}
                        step={1}
                        onSetParam={onSetParam}
                    />
                    <span className="text-[6px] text-muted-foreground/50 self-center">Hold notes to set states</span>
                </div>
            );

        case 'mutation':
            return (
                <div className="flex flex-wrap gap-2 px-1 py-1">
                    <K
                        id={pid}
                        name="depth"
                        label="Depth"
                        value={params?.['depth'] ?? 0.5}
                        min={0}
                        max={1}
                        step={0.01}
                        onSetParam={onSetParam}
                    />
                    <K
                        id={pid}
                        name="rate"
                        label="Rate"
                        value={params?.['rate'] ?? 1}
                        min={0.1}
                        max={10}
                        step={0.1}
                        onSetParam={onSetParam}
                    />
                </div>
            );

        default:
            return null;
    }
};
