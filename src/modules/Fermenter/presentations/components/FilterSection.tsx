/**
 * Filter section — interactive frequency response + cutoff/resonance/drive/keytrack knobs.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { FilterResponse } from '#/modules/Workspace/presentations/components/FilterResponse';
import { FILTER_MODE_NAMES } from '../../models/FermenterPatch';

type FilterSectionProps = {
    cutoff: number;
    resonance: number;
    mode: number;
    envAmount: number;
    drive: number;
    keytrack: number;
    onCutoffChange: (v: number) => void;
    onResonanceChange: (v: number) => void;
    onModeChange: (v: number) => void;
    onEnvAmountChange: (v: number) => void;
    onDriveChange: (v: number) => void;
    onKeytrackChange: (v: number) => void;
};

export const FilterSection = ({
    cutoff,
    resonance,
    mode,
    envAmount,
    drive,
    keytrack,
    onCutoffChange,
    onResonanceChange,
    onModeChange,
    onEnvAmountChange,
    onDriveChange,
    onKeytrackChange,
}: FilterSectionProps): ReactElement => (
    <div className="space-y-2">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            Filter
        </div>

        {/* Interactive filter curve */}
        <div className="flex justify-center">
            <FilterResponse
                cutoff={cutoff}
                resonance={resonance}
                filterType={mode}
                width={220}
                height={72}
                onParamChange={(id, val) => {
                    if (id === 'filterCutoff') { onCutoffChange(val); }
                    if (id === 'filterResonance') { onResonanceChange(val); }
                }}
            />
        </div>

        {/* Filter mode selector */}
        <div className="flex gap-1 justify-center">
            {FILTER_MODE_NAMES.map((name, i) => (
                <button
                    key={name}
                    type="button"
                    className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                        mode === i
                            ? 'bg-[var(--color-accent-cyan)] text-white'
                            : 'bg-surface-raised/50 text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => onModeChange(i)}
                >
                    {name}
                </button>
            ))}
        </div>

        {/* Primary knobs: Cutoff + Resonance */}
        <div className="flex items-end gap-2 px-1">
            <div className="flex flex-col items-center gap-0.5">
                <RotaryKnob value={cutoff} onChange={onCutoffChange} min={20} max={20000} step={10} defaultValue={5000} size="xl" />
                <span className="text-[8px] text-muted-foreground">Cutoff</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">
                    {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)}k` : String(Math.round(cutoff))}
                </span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
                <RotaryKnob value={resonance} onChange={onResonanceChange} min={0.5} max={20} step={0.1} defaultValue={1} size="xl" />
                <span className="text-[8px] text-muted-foreground">Reso</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{resonance.toFixed(1)}</span>
            </div>
        </div>

        {/* Secondary: Drive, Env Amount, Key Track */}
        <div className="flex items-end gap-2 px-1">
            <div className="flex flex-col items-center gap-0.5">
                <RotaryKnob value={drive} onChange={onDriveChange} min={0} max={10} step={0.1} defaultValue={0} size="lg" />
                <span className="text-[8px] text-muted-foreground">Drive</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{drive.toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
                <RotaryKnob value={envAmount} onChange={onEnvAmountChange} min={-1} max={1} step={0.01} defaultValue={0.5} size="lg" />
                <span className="text-[8px] text-muted-foreground">Env</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{(envAmount * 100).toFixed(0)}%</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
                <RotaryKnob value={keytrack} onChange={onKeytrackChange} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                <span className="text-[8px] text-muted-foreground">Key</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(keytrack * 100)}%</span>
            </div>
        </div>
    </div>
);
