/**
 * LevainMacroStrip — 8 musical macro knobs using RotaryKnob.
 * Horizontal in wide contexts, grid in narrow (sidebar).
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

type LevainMacroStripProps = {
    macros: readonly number[];
    labels: readonly string[];
    onMacroChange: (index: number, value: number) => void;
    compact?: boolean;
};

export const LevainMacroStrip = ({ macros, labels, onMacroChange, compact }: LevainMacroStripProps): ReactElement => (
    <div className={compact ? 'grid grid-cols-4 gap-1' : 'flex items-center gap-2 flex-wrap'}>
        {labels.map((label, i) => (
            <RotaryKnob
                key={label}
                value={macros[i] ?? 0.5}
                onChange={(v) => onMacroChange(i, v)}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.5}
                size={compact ? 'sm' : 'md'}
                label={label}
            />
        ))}
    </div>
);
