/**
 * HumanizePanel — humanization controls.
 *
 * Hero: single large knob (xl) for the master humanize amount.
 * Below: detail knobs for timing, tuning, dynamic, vibrato variation.
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { type HumanizeConfig } from '../../models/LevainPatch';

type HumanizePanelProps = {
    config: HumanizeConfig;
    onChange: (partial: Partial<HumanizeConfig>) => void;
};

export const HumanizePanel = ({ config, onChange }: HumanizePanelProps): ReactElement => {
    return (
        <Stack gap={4} className="max-w-[340px]">
            {/* Header */}
            <DawPluginSectionHeader title="Humanization" titleClassName="text-muted-foreground" />

            {/* Hero: large humanize knob centered */}
            <Stack align="center" gap={1} className="py-2">
                <RotaryKnob
                    value={config.amount}
                    onChange={(v) => onChange({ amount: v })}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size="xl"
                    tone="amber"
                />
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Humanize</span>
                <span className="text-[7px] text-muted-foreground/40 tabular-nums">
                    {Math.round(config.amount * 100)}%
                </span>
            </Stack>

            {/* Detail knobs row */}
            <Row align="end" justify="center" gap={2}>
                <Stack align="center">
                    <RotaryKnob
                        value={config.timingMaxMs}
                        onChange={(v) => onChange({ timingMaxMs: v })}
                        min={0}
                        max={25}
                        step={0.5}
                        defaultValue={15}
                        size="md"
                        tone="amber"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Timing</span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{config.timingMaxMs.toFixed(0)}ms
                    </span>
                </Stack>

                <Stack align="center">
                    <RotaryKnob
                        value={config.tuningMaxCents}
                        onChange={(v) => onChange({ tuningMaxCents: v })}
                        min={0}
                        max={10}
                        step={0.5}
                        defaultValue={5}
                        size="md"
                        tone="amber"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Tuning</span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{config.tuningMaxCents.toFixed(0)}ct
                    </span>
                </Stack>

                <Stack align="center">
                    <RotaryKnob
                        value={config.dynamicMax * 100}
                        onChange={(v) => onChange({ dynamicMax: v / 100 })}
                        min={0}
                        max={15}
                        step={0.5}
                        defaultValue={8}
                        size="md"
                        tone="amber"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Dynamic</span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{(config.dynamicMax * 100).toFixed(0)}%
                    </span>
                </Stack>

                <Stack align="center">
                    <RotaryKnob
                        value={config.vibratoVarMax * 100}
                        onChange={(v) => onChange({ vibratoVarMax: v / 100 })}
                        min={0}
                        max={30}
                        step={1}
                        defaultValue={15}
                        size="md"
                        tone="amber"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Vib Var</span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{(config.vibratoVarMax * 100).toFixed(0)}%
                    </span>
                </Stack>
            </Row>
        </Stack>
    );
};
