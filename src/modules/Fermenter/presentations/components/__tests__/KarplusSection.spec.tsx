import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { KarplusSection } from '../KarplusSection';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        damping: 0.5,
        brightness: 0.7,
        onDampingChange: vi.fn(),
        onBrightnessChange: vi.fn(),
        ...overrides,
    };
}

describe('KarplusSection', () => {
    describe('readout formatting', () => {
        it('formats damping as a whole-number percentage', () => {
            render(<KarplusSection {...defaultProps({ damping: 0.426 })} />);
            // 0.426 * 100 = 42.6 → toFixed(0) → "43"
            expect(screen.getByText('43%')).toBeInTheDocument();
        });

        it('formats brightness as a whole-number percentage', () => {
            render(<KarplusSection {...defaultProps({ brightness: 0.85 })} />);
            expect(screen.getByText('85%')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('emits onDampingChange when the Damping slider is incremented', () => {
            const onDampingChange = vi.fn();
            render(<KarplusSection {...defaultProps({ onDampingChange })} />);
            const dampingSlider = screen.getAllByRole('slider')[0]!;
            dampingSlider.focus();
            fireEvent.keyDown(dampingSlider, { key: 'ArrowUp' });
            // RotaryKnob forwards (value, isTransient); the section passes the
            // callback straight through, so both args are present.
            expect(onDampingChange).toHaveBeenCalledWith(0.51, false);
        });

        it('emits onBrightnessChange when the Brightness slider is incremented', () => {
            const onBrightnessChange = vi.fn();
            render(<KarplusSection {...defaultProps({ brightness: 0.7, onBrightnessChange })} />);
            const brightnessSlider = screen.getAllByRole('slider')[1]!;
            brightnessSlider.focus();
            fireEvent.keyDown(brightnessSlider, { key: 'ArrowUp' });
            // 0.7 + step 0.01 = 0.71
            expect(onBrightnessChange).toHaveBeenCalledWith(0.71, false);
        });
    });
});
