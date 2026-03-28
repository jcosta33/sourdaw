/**
 * Macro strip — 8 musical knobs that map to synth parameters.
 * The beginner safe zone: meaningful control without opening internals.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { MACRO_LABELS } from '../../models/FermenterPatch';

type MacroStripProps = {
    values: readonly number[];
    onChange: (index: number, value: number) => void;
};

export const MacroStrip = ({ values, onChange }: MacroStripProps): ReactElement => (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface-well/50 border-b border-border/30">
        {MACRO_LABELS.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
                <RotaryKnob
                    value={values[i] ?? 0.5}
                    onChange={(v) => onChange(i, v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size="md"
                />
                <span className="text-[8px] text-muted-foreground/70 uppercase tracking-wider">
                    {label}
                </span>
            </div>
        ))}
    </div>
);
