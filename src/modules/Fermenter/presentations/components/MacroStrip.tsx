/**
 * Macro strip — adapts to available space.
 * Horizontal in wide contexts, grid in narrow (sidebar) contexts.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { MACRO_LABELS } from '../../models/FermenterPatch';

type MacroStripProps = {
    values: readonly number[];
    onChange: (index: number, value: number) => void;
    compact?: boolean;
};

export const MacroStrip = ({ values, onChange, compact }: MacroStripProps): ReactElement => (
    <div className={compact ? 'grid grid-cols-4 gap-1' : 'flex items-center gap-2 flex-wrap'}>
        {MACRO_LABELS.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-0">
                <RotaryKnob
                    value={values[i] ?? 0.5}
                    onChange={(v) => onChange(i, v)}
                    min={0} max={1} step={0.01} defaultValue={0.5}
                    size={compact ? 'sm' : 'md'}
                />
                <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-tight">
                    {label}
                </span>
            </div>
        ))}
    </div>
);
