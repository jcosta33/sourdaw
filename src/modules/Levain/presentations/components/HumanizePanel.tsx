/**
 * HumanizePanel — humanization controls.
 *
 * Hero: single large knob (xl) for the master humanize amount.
 * Below: detail knobs for timing, tuning, dynamic, vibrato variation.
 */
import { type ReactElement } from 'react';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type HumanizeConfig } from '../../models/LevainPatch';


type HumanizePanelProps = {
    config: HumanizeConfig;
    onChange: (partial: Partial<HumanizeConfig>) => void;
};

export const HumanizePanel = ({ config, onChange }: HumanizePanelProps): ReactElement => {
    return (
        <div className="space-y-4 max-w-[340px]">
            {/* Header */}
            <DawPluginSectionHeader title="Humanization" titleClassName="text-muted-foreground" />

            {/* Hero: large humanize knob centered */}
            <div className="flex flex-col items-center gap-1 py-2">
                <RotaryKnob
                    value={config.amount}
                    onChange={(v) => onChange({ amount: v })}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size="xl"
                />
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                    Humanize
                </span>
                <span className="text-[7px] text-muted-foreground/40 tabular-nums">
                    {Math.round(config.amount * 100)}%
                </span>
            </div>

            {/* Detail knobs row */}
            <div className="flex items-end gap-2 justify-center">
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.timingMaxMs}
                        onChange={(v) => onChange({ timingMaxMs: v })}
                        min={0}
                        max={25}
                        step={0.5}
                        defaultValue={15}
                        size="md"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Timing
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{config.timingMaxMs.toFixed(0)}ms
                    </span>
                </div>

                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.tuningMaxCents}
                        onChange={(v) => onChange({ tuningMaxCents: v })}
                        min={0}
                        max={10}
                        step={0.5}
                        defaultValue={5}
                        size="md"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Tuning
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{config.tuningMaxCents.toFixed(0)}ct
                    </span>
                </div>

                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.dynamicMax * 100}
                        onChange={(v) => onChange({ dynamicMax: v / 100 })}
                        min={0}
                        max={15}
                        step={0.5}
                        defaultValue={8}
                        size="md"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Dynamic
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{(config.dynamicMax * 100).toFixed(0)}%
                    </span>
                </div>

                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.vibratoVarMax * 100}
                        onChange={(v) => onChange({ vibratoVarMax: v / 100 })}
                        min={0}
                        max={30}
                        step={1}
                        defaultValue={15}
                        size="md"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Vib Var
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        ±{(config.vibratoVarMax * 100).toFixed(0)}%
                    </span>
                </div>
            </div>
        </div>
    );
};
