import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { FmSection } from '../FmSection';

// Test-only Knob: surfaces paramId/value and invokes onChange on click.
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
            onClick={() => onChange(0.7)}
        >
            knob
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        algorithm: 1,
        ratios: [1, 2, 0.5, 4] as [number, number, number, number],
        levels: [1, 0.5, 0.25, 0.1] as [number, number, number, number],
        feedback: 0.3,
        modAmount: 2,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('FmSection', () => {
    describe('algorithm selector', () => {
        it('selects the option matching the algorithm index and emits fmAlgorithm on change', () => {
            const onParam = vi.fn();
            render(<FmSection {...defaultProps({ algorithm: 2, onParam })} />);
            const select = screen.getByRole('combobox') as HTMLSelectElement;
            expect(select.value).toBe('2');
            fireEvent.change(select, { target: { value: '5' } });
            expect(onParam).toHaveBeenCalledWith('fmAlgorithm', 5);
        });

        it('renders all eight FM algorithm names as options', () => {
            render(<FmSection {...defaultProps()} />);
            const options = [...screen.getByRole('combobox').querySelectorAll('option')].map((o) => o.textContent);
            expect(options).toContain('Stack (4→3→2→1)');
            expect(options).toContain('Additive (all)');
            expect(options).toContain('Mixed');
            expect(options.length).toBe(8);
        });
    });

    describe('operator rendering', () => {
        it('renders four operators labelled Op 1–4', () => {
            render(<FmSection {...defaultProps()} />);
            expect(screen.getByText('Op 1')).toBeTruthy();
            expect(screen.getByText('Op 2')).toBeTruthy();
            expect(screen.getByText('Op 3')).toBeTruthy();
            expect(screen.getByText('Op 4')).toBeTruthy();
        });

        it('formats each operator ratio as n× and level as a percentage', () => {
            render(<FmSection {...defaultProps()} />);
            // ratios [1,2,0.5,4] → 1.0×, 2.0×, 0.5×, 4.0×
            expect(screen.getByText('1.0×')).toBeTruthy();
            expect(screen.getByText('2.0×')).toBeTruthy();
            expect(screen.getByText('0.5×')).toBeTruthy();
            expect(screen.getByText('4.0×')).toBeTruthy();
            // levels [1,0.5,0.25,0.1] → 100%, 50%, 25%, 10%
            expect(screen.getByText('100%')).toBeTruthy();
            expect(screen.getByText('50%')).toBeTruthy();
            expect(screen.getByText('25%')).toBeTruthy();
            expect(screen.getByText('10%')).toBeTruthy();
        });

        it('applies the per-operator accent colour class', () => {
            render(<FmSection {...defaultProps()} />);
            const op1 = screen.getByText('Op 1');
            expect(op1.className).toContain('accent-cyan');
            const op2 = screen.getByText('Op 2');
            expect(op2.className).toContain('accent-mint');
        });
    });

    describe('knob param routing', () => {
        it('routes each operator ratio knob to onParam with fmRatioN', () => {
            const onParam = vi.fn();
            render(<FmSection {...defaultProps({ onParam })} />);
            const knobs = screen.getAllByTestId('knob');
            // knobs are ordered: ratio1, level1, ratio2, level2, ... then feedback, modAmount
            fireEvent.click(knobs[0]!);
            expect(onParam).toHaveBeenCalledWith('fmRatio1', 0.7);
            fireEvent.click(knobs[2]!);
            expect(onParam).toHaveBeenCalledWith('fmRatio2', 0.7);
        });

        it('routes each operator level knob to onParam with fmLevelN', () => {
            const onParam = vi.fn();
            render(<FmSection {...defaultProps({ onParam })} />);
            const knobs = screen.getAllByTestId('knob');
            fireEvent.click(knobs[1]!);
            expect(onParam).toHaveBeenCalledWith('fmLevel1', 0.7);
            fireEvent.click(knobs[7]!);
            expect(onParam).toHaveBeenCalledWith('fmLevel4', 0.7);
        });

        it('routes the feedback and mod-depth knobs', () => {
            const onParam = vi.fn();
            render(<FmSection {...defaultProps({ onParam })} />);
            const knobs = screen.getAllByTestId('knob');
            // after 8 operator knobs (4 ratio + 4 level), feedback then modAmount
            const feedbackKnob = knobs[8]!;
            const modKnob = knobs[9]!;
            expect(feedbackKnob.getAttribute('data-paramid')).toBe('fmFeedback');
            expect(modKnob.getAttribute('data-paramid')).toBe('fmModAmount');
            fireEvent.click(feedbackKnob);
            expect(onParam).toHaveBeenCalledWith('fmFeedback', 0.7);
            fireEvent.click(modKnob);
            expect(onParam).toHaveBeenCalledWith('fmModAmount', 0.7);
        });

        it('labels the feedback and mod-depth knobs', () => {
            render(<FmSection {...defaultProps()} />);
            expect(screen.getByText('Feedback')).toBeTruthy();
            expect(screen.getByText('Depth')).toBeTruthy();
        });
    });
});
