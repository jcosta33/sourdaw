/**
 * HumanizePanel — humanization controls.
 *
 * Hero: single large knob (xl) for the master humanize amount.
 * Below: detail knobs for timing, tuning, dynamic, vibrato variation.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type HumanizeConfig } from '../../models/OrchestraPatch';
import { setHumanizeAmount } from '../../stores/orchestralStore';
import { setOrchestraParamWithAudio } from '../../useCases/orchestralParamBridge';

type HumanizePanelProps = {
    config: HumanizeConfig;
};

export const HumanizePanel = ({ config }: HumanizePanelProps): ReactElement => {
    return (
        <div className="space-y-4 max-w-[340px]">
            {/* Header */}
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Humanization
            </span>

            {/* Hero: large humanize knob centered */}
            <div className="flex flex-col items-center gap-1 py-2">
                <RotaryKnob
                    value={config.amount}
                    onChange={(v) => setHumanizeAmount(v)}
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
                        onChange={(v) =>
                            setOrchestraParamWithAudio('humanize', { ...config, timingMaxMs: v })
                        }
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
                        onChange={(v) =>
                            setOrchestraParamWithAudio('humanize', { ...config, tuningMaxCents: v })
                        }
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
                        onChange={(v) =>
                            setOrchestraParamWithAudio('humanize', { ...config, dynamicMax: v / 100 })
                        }
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
                        onChange={(v) =>
                            setOrchestraParamWithAudio('humanize', { ...config, vibratoVarMax: v / 100 })
                        }
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
