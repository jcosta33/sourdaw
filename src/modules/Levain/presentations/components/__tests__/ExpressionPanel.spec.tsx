import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { ExpressionPanel } from '../ExpressionPanel';

// Expose each RotaryKnob as a plain range input keyed by its max so a knob's
// onChange is observable through the public component surface.
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

describe('ExpressionPanel', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        const { container } = render(
            <ExpressionPanel
                expression={patch.expression}
                legato={patch.legato}
                onChangeExp={vi.fn()}
                onChangeLeg={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('forwards the chosen CC1 curve through onChangeExp when a curve chip is clicked', () => {
        const patch = createDefaultPatch('violin-1');
        const onChangeExp = vi.fn();

        render(
            <ExpressionPanel
                expression={patch.expression}
                legato={patch.legato}
                onChangeExp={onChangeExp}
                onChangeLeg={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /logarithmic/i }));

        expect(onChangeExp).toHaveBeenCalledWith({ cc1Curve: 'logarithmic' });
    });

    it('toggles legato.enabled through onChangeLeg', () => {
        const patch = createDefaultPatch('violin-1');
        const onChangeLeg = vi.fn();

        render(
            <ExpressionPanel
                expression={patch.expression}
                legato={{ ...patch.legato, enabled: true }}
                onChangeExp={vi.fn()}
                onChangeLeg={onChangeLeg}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /legato on/i }));

        expect(onChangeLeg).toHaveBeenCalledWith({ enabled: false });
    });

    it('forwards the edited vibrato-depth value through onChangeExp', () => {
        const patch = createDefaultPatch('violin-1');
        const onChangeExp = vi.fn();

        render(
            <ExpressionPanel
                expression={patch.expression}
                legato={patch.legato}
                onChangeExp={onChangeExp}
                onChangeLeg={vi.fn()}
            />
        );

        // The vibrato-depth knob is the only one with max=50.
        fireEvent.change(screen.getByTestId('knob-max-50'), { target: { value: '33' } });

        expect(onChangeExp).toHaveBeenCalledWith({ vibratoDepthMax: 33 });
    });
});
