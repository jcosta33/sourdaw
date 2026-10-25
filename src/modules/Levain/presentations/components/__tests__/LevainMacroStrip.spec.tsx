import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { LevainMacroStrip } from '../LevainMacroStrip';

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
        fireEvent.keyDown(screen.getByRole('slider', { name: patch.macroLabels[4] }), { key: 'ArrowUp' });

        expect(onMacroChange).toHaveBeenCalledWith(4, expect.any(Number));
    });

    it('makes only Space unavailable when the bank has no Room microphone', () => {
        const patch = createDefaultPatch('violin-1');
        const onMacroChange = vi.fn();
        render(
            <LevainMacroStrip
                macros={patch.macros}
                labels={patch.macroLabels}
                onMacroChange={onMacroChange}
                spaceAvailable={false}
            />
        );

        const space = screen.getByRole('slider', { name: 'Space' });
        expect(space).toHaveAttribute('aria-disabled', 'true');
        expect(space).toHaveAttribute('title', 'Space requires a loaded Room microphone position.');
        expect(screen.getByText('Requires a Room mic')).toBeInTheDocument();
        const otherKnobs = screen.getAllByRole('slider').filter((knob) => knob !== space);
        expect(otherKnobs).toHaveLength(patch.macroLabels.length - 1);
        for (const knob of otherKnobs) {
            expect(knob).not.toHaveAttribute('aria-disabled', 'true');
        }

        fireEvent.keyDown(space, { key: 'ArrowUp' });
        expect(onMacroChange).not.toHaveBeenCalled();
    });

    it('keeps Space enabled when the bank has a Room microphone', () => {
        const patch = createDefaultPatch('violin-1');
        const onMacroChange = vi.fn();
        render(
            <LevainMacroStrip
                macros={patch.macros}
                labels={patch.macroLabels}
                onMacroChange={onMacroChange}
                spaceAvailable
            />
        );

        const space = screen.getByRole('slider', { name: 'Space' });
        fireEvent.keyDown(space, { key: 'ArrowUp' });
        expect(onMacroChange).toHaveBeenCalledWith(4, expect.any(Number));
    });
});
