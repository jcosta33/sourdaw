import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FilterSection } from '../FilterSection';

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
            onClick={() => onChange(0.9)}
        >
            knob
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        model: DEFAULT_PATCH.filterModel,
        cutoff: DEFAULT_PATCH.filterCutoff,
        resonance: DEFAULT_PATCH.filterResonance,
        mode: DEFAULT_PATCH.filterMode,
        envAmount: DEFAULT_PATCH.filterEnvAmount,
        drive: DEFAULT_PATCH.filterDrive,
        keytrack: DEFAULT_PATCH.filterKeytrack,
        onModelChange: vi.fn(),
        onCutoffChange: vi.fn(),
        onResonanceChange: vi.fn(),
        onModeChange: vi.fn(),
        onEnvAmountChange: vi.fn(),
        onDriveChange: vi.fn(),
        onKeytrackChange: vi.fn(),
        ...overrides,
    };
}

function knobByParamId(paramId: string): HTMLElement | undefined {
    return screen.getAllByTestId('knob').find((k) => k.dataset.paramid === paramId);
}

describe('FilterSection', () => {
    describe('model selection', () => {
        it.each([
            [0, 'SVF (Clean)'],
            [1, 'Moog (Warm)'],
            [2, 'Diode (Acid)'],
            [3, 'Formant (Vowel)'],
            [4, 'MS-20 (Grit)'],
            [5, 'SEM (Cream)'],
        ])('routes model index %i chip click to onModelChange', (index, label) => {
            const onModelChange = vi.fn();
            render(<FilterSection {...defaultProps({ onModelChange })} />);
            fireEvent.click(screen.getByText(label));
            expect(onModelChange).toHaveBeenLastCalledWith(index);
        });
    });

    describe('filter mode selector (SVF only)', () => {
        it('shows the LP/HP/BP/Notch mode chips only when model is SVF (0)', () => {
            render(<FilterSection {...defaultProps({ model: 0 })} />);
            expect(screen.getByText('Low Pass')).toBeInTheDocument();
            expect(screen.getByText('Notch')).toBeInTheDocument();
        });

        it('hides the mode chips and shows the model description for non-SVF models', () => {
            render(<FilterSection {...defaultProps({ model: 1 })} />);
            // Moog model → mode chips absent, description shown.
            expect(screen.queryByText('Low Pass')).not.toBeInTheDocument();
            expect(screen.getByText('24dB Moog — Self-oscillating warmth')).toBeInTheDocument();
        });

        it.each([
            [1, '24dB Moog — Self-oscillating warmth'],
            [2, '24dB Diode — Asymmetric acid squelch'],
            [3, 'Vowel morph — Cutoff sweeps A→E→I→O→U'],
            [4, 'MS-20 — HP→LP cascade, gritty'],
            [5, 'SEM 12dB — Creamy LP→Notch→HP morph'],
        ])('shows the correct description for model %i', (model, description) => {
            render(<FilterSection {...defaultProps({ model })} />);
            expect(screen.getByText(description)).toBeInTheDocument();
        });

        it('routes a mode-chip click to onModeChange with the clicked index', () => {
            const onModeChange = vi.fn();
            render(<FilterSection {...defaultProps({ model: 0, onModeChange })} />);
            fireEvent.click(screen.getByText('High Pass'));
            expect(onModeChange).toHaveBeenLastCalledWith(1);
            fireEvent.click(screen.getByText('Band Pass'));
            expect(onModeChange).toHaveBeenLastCalledWith(2);
            fireEvent.click(screen.getByText('Notch'));
            expect(onModeChange).toHaveBeenLastCalledWith(3);
        });
    });

    describe('cutoff readout formatting', () => {
        it('formats sub-1kHz cutoffs as a rounded whole number of Hz', () => {
            render(<FilterSection {...defaultProps({ cutoff: 845.6 })} />);
            expect(screen.getByText('846')).toBeInTheDocument();
        });

        it('formats 1kHz+ cutoffs as kilohertz with one decimal', () => {
            render(<FilterSection {...defaultProps({ cutoff: 5200 })} />);
            expect(screen.getByText('5.2k')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('routes Cutoff/Reso/Drive/Env/Key knobs to their callbacks', () => {
            const onCutoffChange = vi.fn();
            const onResonanceChange = vi.fn();
            const onDriveChange = vi.fn();
            const onEnvAmountChange = vi.fn();
            const onKeytrackChange = vi.fn();
            render(
                <FilterSection
                    {...defaultProps({
                        onCutoffChange,
                        onResonanceChange,
                        onDriveChange,
                        onEnvAmountChange,
                        onKeytrackChange,
                    })}
                />
            );

            fireEvent.click(knobByParamId('filterCutoff')!);
            expect(onCutoffChange).toHaveBeenLastCalledWith(0.9);
            fireEvent.click(knobByParamId('filterResonance')!);
            expect(onResonanceChange).toHaveBeenLastCalledWith(0.9);
            fireEvent.click(knobByParamId('filterDrive')!);
            expect(onDriveChange).toHaveBeenLastCalledWith(0.9);
            fireEvent.click(knobByParamId('filterEnvAmount')!);
            expect(onEnvAmountChange).toHaveBeenLastCalledWith(0.9);
            fireEvent.click(knobByParamId('filterKeytrack')!);
            expect(onKeytrackChange).toHaveBeenLastCalledWith(0.9);
        });
    });

    describe('interactive filter curve', () => {
        // The FilterResponse visualizer emits filterCutoff (horizontal) and
        // filterResonance (vertical) during a pointer drag. Drive a known
        // pointer path and assert the section routes both to its callbacks.
        function mockCanvasRect(width: number, height: number): void {
            const canvas = screen.getByRole('img');
            canvas.getBoundingClientRect = () => ({
                left: 0,
                top: 0,
                width,
                height,
                right: width,
                bottom: height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });
        }

        it('routes a horizontal drag to onCutoffChange and a vertical drag to onResonanceChange', () => {
            const onCutoffChange = vi.fn();
            const onResonanceChange = vi.fn();
            render(
                <FilterSection
                    {...defaultProps({
                        model: 0,
                        cutoff: 1000,
                        resonance: 1,
                        onCutoffChange,
                        onResonanceChange,
                    })}
                />
            );
            const canvas = screen.getByRole('img');
            mockCanvasRect(500, 120);

            fireEvent.pointerDown(canvas, { clientX: 0, clientY: 60, pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: 250, clientY: 30, pointerId: 1 });

            // A real drag emits both params; assert the section routed them.
            expect(onCutoffChange).toHaveBeenCalled();
            expect(onResonanceChange).toHaveBeenCalled();
        });
    });
});
