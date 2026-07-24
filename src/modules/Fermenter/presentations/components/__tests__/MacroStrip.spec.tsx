import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { MACRO_LABELS } from '../../../models/FermenterPatch';
import { MacroStrip } from '../MacroStrip';

describe('MacroStrip', () => {
    it('renders one labeled knob per macro (eight total)', () => {
        render(<MacroStrip values={[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]} onChange={vi.fn()} />);
        for (const label of MACRO_LABELS) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('routes the first macro knob change to onChange(0, value)', () => {
        const onChange = vi.fn();
        render(<MacroStrip values={[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]} onChange={onChange} />);
        const firstSlider = screen.getAllByRole('slider')[0]!;
        firstSlider.focus();
        fireEvent.keyDown(firstSlider, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(0, 0.51);
    });

    it('routes the fourth macro knob change to onChange(3, value)', () => {
        const onChange = vi.fn();
        render(<MacroStrip values={[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]} onChange={onChange} />);
        const fourthSlider = screen.getAllByRole('slider')[3]!;
        fourthSlider.focus();
        fireEvent.keyDown(fourthSlider, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(3, 0.51);
    });

    it('falls back to 0.5 for any macro without an explicit value', () => {
        // Only provide the first value; the rest must default to 0.5.
        render(<MacroStrip values={[0.2]} onChange={vi.fn()} />);
        const sliders = screen.getAllByRole('slider');
        // Slider 1 (Motion, index 1) has no value → 0.5.
        expect(sliders[1]!.getAttribute('aria-valuenow')).toBe('0.5');
    });

    it('renders all eight macro knobs and routes correctly in compact mode', () => {
        const onChange = vi.fn();
        // compact only changes presentation (size + grid layout); routing is
        // identical. Verify behaviour rather than CSS.
        render(<MacroStrip values={[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]} onChange={onChange} compact />);
        expect(screen.getAllByRole('slider')).toHaveLength(8);
        const lastSlider = screen.getAllByRole('slider')[7]!;
        lastSlider.focus();
        fireEvent.keyDown(lastSlider, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(7, 0.51);
    });
});
