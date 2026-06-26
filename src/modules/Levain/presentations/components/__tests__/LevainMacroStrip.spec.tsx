import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { LevainMacroStrip } from '../LevainMacroStrip';

// Expose each RotaryKnob as a labelled range input so the per-macro onChange is
// observable. The label is still rendered so the render-smoke test holds.
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) => (
        <label>
            {label}
            <input type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        </label>
    ),
}));

describe('LevainMacroStrip', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(<LevainMacroStrip macros={patch.macros} labels={patch.macroLabels} onMacroChange={vi.fn()} />);
        expect(screen.getByText(patch.macroLabels[0])).toBeInTheDocument();
    });

    it('forwards the macro index and value through onMacroChange', () => {
        const patch = createDefaultPatch('violin-1');
        const onMacroChange = vi.fn();

        render(<LevainMacroStrip macros={patch.macros} labels={patch.macroLabels} onMacroChange={onMacroChange} />);

        // Index 4 is the 'Space' macro in the default labels.
        fireEvent.change(screen.getByLabelText(patch.macroLabels[4]), { target: { value: '0.7' } });

        expect(onMacroChange).toHaveBeenCalledWith(4, 0.7);
    });
});
