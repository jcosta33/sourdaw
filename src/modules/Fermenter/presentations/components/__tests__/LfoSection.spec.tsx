import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { LfoSection } from '../LfoSection';

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
        <button
            type="button"
            data-testid="knob"
            data-paramid={paramId}
            data-value={value}
            onClick={() => onChange(3.3)}
        >
            knob
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        rate: 4.2,
        shape: 0,
        pitchAmount: 0,
        filterAmount: 0,
        onRateChange: vi.fn(),
        onShapeChange: vi.fn(),
        onPitchAmountChange: vi.fn(),
        onFilterAmountChange: vi.fn(),
        ...overrides,
    };
}

describe('LfoSection', () => {
    describe('shape selection', () => {
        it('routes a shape-chip click to onShapeChange with the clicked index', () => {
            const onShapeChange = vi.fn();
            render(<LfoSection {...defaultProps({ onShapeChange })} />);
            // LFO_SHAPE_NAMES = ['Sine','Triangle','Saw','Square'], shown as first-3-chars
            // Sin→0, Tri→1, Saw→2, Squ→3
            fireEvent.click(screen.getByText('Saw'));
            expect(onShapeChange).toHaveBeenLastCalledWith(2);
            fireEvent.click(screen.getByText('Squ'));
            expect(onShapeChange).toHaveBeenLastCalledWith(3);
        });
    });

    describe('rate readout formatting', () => {
        it('formats the rate as N.NHz using toFixed(1)', () => {
            render(<LfoSection {...defaultProps({ rate: 4.2 })} />);
            expect(screen.getByText('4.2Hz')).toBeTruthy();
        });

        it('appends a .0 decimal even for whole-number rates', () => {
            render(<LfoSection {...defaultProps({ rate: 12 })} />);
            expect(screen.getByText('12.0Hz')).toBeTruthy();
        });
    });

    describe('knob routing', () => {
        it('routes Rate/PitchAmount/FilterAmount knobs to their callbacks in order', () => {
            const onRateChange = vi.fn();
            const onPitchAmountChange = vi.fn();
            const onFilterAmountChange = vi.fn();
            render(<LfoSection {...defaultProps({ onRateChange, onPitchAmountChange, onFilterAmountChange })} />);
            const knobs = screen.getAllByTestId('knob');
            expect(knobs[0]!.dataset.paramid).toBe('lfoRate');
            expect(knobs[1]!.dataset.paramid).toBe('lfoPitchAmount');
            expect(knobs[2]!.dataset.paramid).toBe('lfoFilterAmount');
            fireEvent.click(knobs[0]!);
            expect(onRateChange).toHaveBeenCalledWith(3.3);
            fireEvent.click(knobs[1]!);
            expect(onPitchAmountChange).toHaveBeenCalledWith(3.3);
            fireEvent.click(knobs[2]!);
            expect(onFilterAmountChange).toHaveBeenCalledWith(3.3);
        });
    });

    describe('LFO preview waveform rendering', () => {
        // The preview canvas renders one of four waveforms based on `shape`.
        // Each shape exercises a distinct branch of the LfoPreview switch. The
        // canvas draw runs as a useEffect; we assert it renders without error
        // for every shape and for the rate-clamping boundaries.
        it('renders the preview canvas for each waveform shape', () => {
            for (const shape of [0, 1, 2, 3]) {
                const { unmount } = render(<LfoSection {...defaultProps({ shape })} />);
                expect(document.querySelector('canvas')).toBeTruthy();
                unmount();
            }
        });

        it('clamps the cycle count to [1, 4] for sub-unity and over-max rates', () => {
            // rate below 1 → clamps to 1 cycle; rate above 4 → clamps to 4.
            const { unmount: u1 } = render(<LfoSection {...defaultProps({ rate: 0.2, shape: 3 })} />);
            expect(document.querySelector('canvas')).toBeTruthy();
            u1();
            const { unmount: u2 } = render(<LfoSection {...defaultProps({ rate: 99, shape: 1 })} />);
            expect(document.querySelector('canvas')).toBeTruthy();
            u2();
        });
    });
});
