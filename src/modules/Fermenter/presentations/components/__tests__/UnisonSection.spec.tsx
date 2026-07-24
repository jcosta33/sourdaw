import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { UnisonSection } from '../UnisonSection';

// Test-only Knob: surfaces paramId and invokes onChange on click.
function TestKnob({
    paramId,
    value,
    onChange,
}: {
    paramId?: string;
    value: number;
    onChange: (v: number) => void;
}): ReactElement {
    return (
        <button type="button" data-testid="knob" data-paramid={paramId} data-value={value} onClick={() => onChange(7)}>
            knob
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        voices: 1,
        detune: 15,
        spread: 0.7,
        onVoicesChange: vi.fn(),
        onDetuneChange: vi.fn(),
        onSpreadChange: vi.fn(),
        ...overrides,
    };
}

describe('UnisonSection', () => {
    describe('readout formatting', () => {
        it('renders the voice count as an integer', () => {
            render(<UnisonSection {...defaultProps({ voices: 4 })} />);
            expect(screen.getByText('4')).toBeInTheDocument();
        });

        it('rounds the detune to whole cents', () => {
            render(<UnisonSection {...defaultProps({ detune: 23.6 })} />);
            expect(screen.getByText('24ct')).toBeInTheDocument();
        });

        it('formats the stereo spread as a whole-number percentage', () => {
            render(<UnisonSection {...defaultProps({ spread: 0.555 })} />);
            // 0.555 * 100 = 55.5 → rounds to 56
            expect(screen.getByText('56%')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('routes Voices/Detune/Spread knobs to their callbacks', () => {
            const onVoicesChange = vi.fn();
            const onDetuneChange = vi.fn();
            const onSpreadChange = vi.fn();
            render(<UnisonSection {...defaultProps({ onVoicesChange, onDetuneChange, onSpreadChange })} />);
            const knobs = screen.getAllByTestId('knob');
            expect(knobs[0]!.dataset.paramid).toBe('unisonVoices');
            expect(knobs[1]!.dataset.paramid).toBe('unisonDetune');
            expect(knobs[2]!.dataset.paramid).toBe('unisonSpread');

            fireEvent.click(knobs[0]!);
            expect(onVoicesChange).toHaveBeenLastCalledWith(7);
            fireEvent.click(knobs[1]!);
            expect(onDetuneChange).toHaveBeenLastCalledWith(7);
            fireEvent.click(knobs[2]!);
            expect(onSpreadChange).toHaveBeenLastCalledWith(7);
        });
    });
});
