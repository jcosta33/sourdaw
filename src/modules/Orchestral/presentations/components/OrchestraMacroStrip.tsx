/**
 * OrchestraMacroStrip — 8 musical macro knobs using RotaryKnob.
 * Horizontal in wide contexts, grid in narrow (sidebar).
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

type OrchestraMacroStripProps = {
    macros: readonly number[];
    labels: readonly string[];
    onMacroChange: (index: number, value: number) => void;
    compact?: boolean;
};

export const OrchestraMacroStrip = ({
    macros,
    labels,
    onMacroChange,
    compact,
}: OrchestraMacroStripProps): ReactElement => (
    <div className={compact ? 'grid grid-cols-4 gap-1' : 'flex items-center gap-2 flex-wrap'}>
        {labels.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-0">
                <RotaryKnob
                    value={macros[i] ?? 0.5}
                    onChange={(v) => onMacroChange(i, v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size={compact ? 'sm' : 'md'}
                />
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight">
                    {label}
                </span>
            </div>
        ))}
    </div>
);
