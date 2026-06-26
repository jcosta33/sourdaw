import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { HumanizePanel } from '../HumanizePanel';

// Expose each RotaryKnob as a plain range input keyed by its max so a knob's
// onChange (and the panel's value transform) is observable.
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) => (
        <input
            type="range"
            data-testid={`knob-max-${max}`}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
        />
    ),
}));

describe('HumanizePanel', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(<HumanizePanel config={patch.humanize} onChange={vi.fn()} />);
        expect(screen.getByText(/humanization/i)).toBeInTheDocument();
    });

    it('forwards the master amount through onChange', () => {
        const patch = createDefaultPatch('violin-1');
        const onChange = vi.fn();

        render(<HumanizePanel config={patch.humanize} onChange={onChange} />);

        // The hero amount knob is the only one with max=1.
        fireEvent.change(screen.getByTestId('knob-max-1'), { target: { value: '0.7' } });

        expect(onChange).toHaveBeenCalledWith({ amount: 0.7 });
    });

    it('rescales the dynamic knob (percent) back to a 0-1 fraction in onChange', () => {
        const patch = createDefaultPatch('violin-1');
        const onChange = vi.fn();

        render(<HumanizePanel config={patch.humanize} onChange={onChange} />);

        // The dynamic knob (max=15, shown as percent) divides by 100 on the way out.
        fireEvent.change(screen.getByTestId('knob-max-15'), { target: { value: '10' } });

        expect(onChange).toHaveBeenCalledWith({ dynamicMax: 0.1 });
    });
});
