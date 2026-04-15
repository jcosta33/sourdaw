/**
 * Filter section — visualization-first.
 * Large interactive filter response as hero. Model/mode selectors integrated.
 * Knobs below for precision. No isolated sub-tabs.
 */
import { type ReactElement } from 'react';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { FilterResponse } from '#/components/daw/visualizers/FilterResponse';
import { FILTER_MODE_NAMES, FILTER_MODEL_NAMES } from '../../models/FermenterPatch';

type FilterSectionProps = {
    model: number;
    cutoff: number;
    resonance: number;
    mode: number;
    envAmount: number;
    drive: number;
    keytrack: number;
    onModelChange: (v: number) => void;
    onCutoffChange: (v: number) => void;
    onResonanceChange: (v: number) => void;
    onModeChange: (v: number) => void;
    onEnvAmountChange: (v: number) => void;
    onDriveChange: (v: number) => void;
    onKeytrackChange: (v: number) => void;
};

export const FilterSection = ({
    model,
    cutoff,
    resonance,
    mode,
    envAmount,
    drive,
    keytrack,
    onModelChange,
    onCutoffChange,
    onResonanceChange,
    onModeChange,
    onEnvAmountChange,
    onDriveChange,
    onKeytrackChange,
}: FilterSectionProps): ReactElement => {
    const isSvf = model === 0;
    const description =
        model === 1
            ? '24dB Moog — Self-oscillating warmth'
            : model === 2
              ? '24dB Diode — Asymmetric acid squelch'
              : model === 3
                ? 'Vowel morph — Cutoff sweeps A→E→I→O→U'
                : model === 4
                  ? 'MS-20 — HP→LP cascade, gritty'
                  : model === 5
                    ? 'SEM 12dB — Creamy LP→Notch→HP morph'
                    : 'Clean SVF — LP/HP/BP/Notch';

    return (
        <div className="space-y-2 w-full">
            {/* Model + mode selectors in one row */}
            <DawPluginSectionHeader
                title="Filter"
                titleClassName="shrink-0 text-muted-foreground"
                className="gap-3"
                actions={
                    <>
                        <div className="flex gap-0.5">
                            {FILTER_MODEL_NAMES.map((name, i) => (
                                <DawPluginChip
                                    key={name}
                                    active={model === i}
                                    tone="cyan"
                                    size="xs"
                                    onClick={() => onModelChange(i)}
                                >
                                    {name}
                                </DawPluginChip>
                            ))}
                        </div>
                        {isSvf ? (
                            <div className="ml-auto flex gap-0.5">
                                {FILTER_MODE_NAMES.map((name, i) => (
                                    <DawPluginChip
                                        key={name}
                                        active={mode === i}
                                        tone="cyan"
                                        size="xs"
                                        onClick={() => onModeChange(i)}
                                    >
                                        {name}
                                    </DawPluginChip>
                                ))}
                            </div>
                        ) : (
                            <span className="ml-auto text-[7px] text-muted-foreground/50">{description}</span>
                        )}
                    </>
                }
            />

            {/* HERO: Large interactive filter curve */}
            <div className="rounded-md overflow-hidden border border-border/20 bg-black/20">
                <FilterResponse
                    cutoff={cutoff}
                    resonance={resonance}
                    filterType={mode}
                    width={500}
                    height={120}
                    onParamChange={(id, val) => {
                        if (id === 'filterCutoff') {onCutoffChange(val);}
                        if (id === 'filterResonance') {onResonanceChange(val);}
                    }}
                />
            </div>

            {/* Knobs — all in one row */}
            <div className="flex items-end gap-3">
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        paramId="filterCutoff"
                        value={cutoff}
                        onChange={onCutoffChange}
                        min={20}
                        max={20000}
                        step={10}
                        defaultValue={5000}
                        scale="log"
                        size="xl"
                        tone="sage"
                    />
                    <span className="text-[7px] text-muted-foreground">Cutoff</span>
                    <span className="text-[6px] text-muted-foreground/50 font-mono">
                        {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)}k` : Math.round(cutoff)}
                    </span>
                </div>
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        paramId="filterResonance"
                        value={resonance}
                        onChange={onResonanceChange}
                        min={0.5}
                        max={20}
                        step={0.1}
                        defaultValue={1}
                        size="xl"
                        tone="sage"
                    />
                    <span className="text-[7px] text-muted-foreground">Reso</span>
                    <span className="text-[6px] text-muted-foreground/50 font-mono">{resonance.toFixed(1)}</span>
                </div>
                <RotaryKnob
                    paramId="filterDrive"
                    value={drive}
                    onChange={onDriveChange}
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={0}
                    size="lg"
                    label="Drive"
                    tone="sage"
                />
                <RotaryKnob
                    paramId="filterEnvAmount"
                    value={envAmount}
                    onChange={onEnvAmountChange}
                    min={-1}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size="lg"
                    label="Env"
                    tone="sage"
                />
                <RotaryKnob
                    paramId="filterKeytrack"
                    value={keytrack}
                    onChange={onKeytrackChange}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="lg"
                    label="Key"
                    tone="sage"
                />
            </div>
        </div>
    );
};
