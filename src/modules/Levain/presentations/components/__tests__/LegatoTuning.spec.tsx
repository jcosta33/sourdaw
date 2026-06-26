import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { LegatoTuning } from '../LegatoTuning';

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

describe('LegatoTuning', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        const { container } = render(<LegatoTuning config={patch.legato} onChange={vi.fn()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('toggles adaptiveSpeed through onChange', () => {
        const patch = createDefaultPatch('violin-1');
        const onChange = vi.fn();

        render(<LegatoTuning config={{ ...patch.legato, adaptiveSpeed: true }} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: /adaptive on/i }));

        expect(onChange).toHaveBeenCalledWith({ adaptiveSpeed: false });
    });

    it('rounds the portamento-velocity knob value in onChange', () => {
        const patch = createDefaultPatch('violin-1');
        const onChange = vi.fn();

        render(<LegatoTuning config={patch.legato} onChange={onChange} />);

        // The portamento-velocity knob is the only one with max=127; it rounds.
        fireEvent.change(screen.getByTestId('knob-max-127'), { target: { value: '72.6' } });

        expect(onChange).toHaveBeenCalledWith({ portamentoVelocityThreshold: 73 });
    });
});
