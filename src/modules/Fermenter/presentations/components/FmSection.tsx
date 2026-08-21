/**
 * FM synthesis controls — algorithm selector, operator ratios + levels, feedback.
 */
import { type ReactElement } from 'react';

import { RotaryKnob, type RotaryKnobComponent } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';

import { FM_ALGORITHM_NAMES } from '../../models/FermenterPatch';

type FmSectionProps = {
    rotaryKnob?: RotaryKnobComponent;
    algorithm: number;
    ratios: [number, number, number, number];
    levels: [number, number, number, number];
    feedback: number;
    modAmount: number;
    onParam: (key: string, value: number) => void;
};

const OP_COLORS = [
    'text-[var(--color-accent-cyan)]',
    'text-[var(--color-accent-mint)]',
    'text-[var(--color-accent-peach)]',
    'text-[var(--color-accent-lavender)]',
];

export const FmSection = ({
    rotaryKnob: Knob = RotaryKnob,
    algorithm,
    ratios,
    levels,
    feedback,
    modAmount,
    onParam,
}: FmSectionProps): ReactElement => {
    return (
        <Stack gap={2}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">FM Engine</div>

            {/* Algorithm selector */}
            <div className="px-1">
                <select
                    value={algorithm}
                    onChange={(e) => onParam('fmAlgorithm', Number(e.target.value))}
                    className="w-full bg-surface-inset border border-border/40 rounded px-1.5 py-0.5 text-[9px] text-foreground cursor-pointer"
                >
                    {FM_ALGORITHM_NAMES.map((name, i) => (
                        <option key={i} value={i}>
                            {name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Operator ratios + levels */}
            <Grid cols={4} gap={1} className="px-1">
                {([0, 1, 2, 3] as const).map((i) => {
                    const ratio = ratios[i];
                    const level = levels[i];
                    return (
                        <Stack align="center" gap={0.5} key={i}>
                            <span className={`text-[8px] font-bold ${OP_COLORS[i]}`}>Op {i + 1}</span>
                            <Knob
                                paramId={`fmRatio${i + 1}`}
                                value={ratio}
                                onChange={(v) => onParam(`fmRatio${i + 1}`, v)}
                                min={0.5}
                                max={16}
                                step={0.5}
                                defaultValue={i + 1}
                                size="sm"
                                tone="sage"
                            />
                            <span className="text-[7px] text-muted-foreground/60 font-mono">{ratio.toFixed(1)}×</span>
                            <Knob
                                paramId={`fmLevel${i + 1}`}
                                value={level}
                                onChange={(v) => onParam(`fmLevel${i + 1}`, v)}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={1}
                                size="sm"
                                tone="sage"
                            />
                            <span className="text-[7px] text-muted-foreground/60 font-mono">
                                {Math.round(level * 100)}%
                            </span>
                        </Stack>
                    );
                })}
            </Grid>

            {/* Feedback + Mod Depth */}
            <Row align="end" gap={2} className="px-1">
                <Stack align="center" gap={0.5}>
                    <Knob
                        paramId="fmFeedback"
                        value={feedback}
                        onChange={(v) => onParam('fmFeedback', v)}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[8px] text-muted-foreground">Feedback</span>
                </Stack>
                <Stack align="center" gap={0.5}>
                    <Knob
                        paramId="fmModAmount"
                        value={modAmount}
                        onChange={(v) => onParam('fmModAmount', v)}
                        min={0}
                        max={4}
                        step={0.01}
                        defaultValue={1}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[8px] text-muted-foreground">Depth</span>
                </Stack>
            </Row>
        </Stack>
    );
};
