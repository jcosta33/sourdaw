import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StepPatternEditor } from '../StepPatternEditor';

import type { ArpStep } from '../../../models/ArpPattern';

function makeStep(overrides: Partial<ArpStep> = {}): ArpStep {
    return {
        active: true,
        stepType: 'note',
        noteSelector: { type: 'next' },
        velocity: 100,
        velocityOverride: false,
        gateMul: 1,
        octaveOffset: 0,
        semitoneOffset: 0,
        probability: 1,
        ratchet: 1,
        ...overrides,
    };
}

function renderEditor(steps: ArpStep[], props: Record<string, unknown> = {}) {
    render(
        <StepPatternEditor steps={steps} currentStep={0} onStepChange={vi.fn()} onLengthChange={vi.fn()} {...props} />
    );
}

describe('StepPatternEditor — step count readout', () => {
    it('renders "Steps: N" with the current step count', () => {
        renderEditor([makeStep(), makeStep(), makeStep()]);
        expect(screen.getByText('Steps: 3')).toBeInTheDocument();
    });
});

describe('StepPatternEditor — length control buttons', () => {
    it('calls onLengthChange(4) with steps.length + 1 when + button clicked', () => {
        const onLengthChange = vi.fn();
        renderEditor([makeStep(), makeStep()], { onLengthChange });
        // The "+" button in the length control row
        const plusButtons = screen.getAllByText('+');
        fireEvent.click(plusButtons[plusButtons.length - 1]!);
        expect(onLengthChange).toHaveBeenCalledWith(3);
    });

    it('calls onLengthChange(n-1) when − button clicked', () => {
        const onLengthChange = vi.fn();
        renderEditor([makeStep(), makeStep()], { onLengthChange });
        fireEvent.click(screen.getByText('−'));
        expect(onLengthChange).toHaveBeenCalledWith(1);
    });

    it('does not reduce below 1 when − clicked on single step', () => {
        const onLengthChange = vi.fn();
        renderEditor([makeStep()], { onLengthChange });
        fireEvent.click(screen.getByText('−'));
        expect(onLengthChange).toHaveBeenCalledWith(1);
    });

    it('calls onLengthChange(8) when the 8 preset clicked', () => {
        const onLengthChange = vi.fn();
        renderEditor([makeStep(), makeStep()], { onLengthChange });
        fireEvent.click(screen.getByText('8'));
        expect(onLengthChange).toHaveBeenCalledWith(8);
    });

    it('renders preset length buttons 4, 8, 16, 32', () => {
        renderEditor([makeStep()]);
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('8')).toBeInTheDocument();
        expect(screen.getByText('16')).toBeInTheDocument();
        expect(screen.getByText('32')).toBeInTheDocument();
    });
});

describe('StepPatternEditor — step toggle (right-click)', () => {
    it('toggles step.active on contextMenu (right-click)', () => {
        const onStepChange = vi.fn();
        renderEditor([makeStep({ active: true })], { onStepChange });
        // The velocity bar div is the first child div with onClick. Right-click on it.
        const stepBars = document.querySelectorAll('[class*="bg-surface-inset"]');
        expect(stepBars.length).toBeGreaterThan(0);
        fireEvent.contextMenu(stepBars[0]!, { preventDefault: vi.fn() });
        expect(onStepChange).toHaveBeenCalledWith(0, expect.objectContaining({ active: false }));
    });
});

describe('StepPatternEditor — octave badge', () => {
    it('renders octave badge +1 when octaveOffset is 1', () => {
        renderEditor([makeStep({ octaveOffset: 1 })]);
        expect(screen.getByText('+1')).toBeInTheDocument();
    });

    it('renders octave badge -2 when octaveOffset is -2', () => {
        renderEditor([makeStep({ octaveOffset: -2 })]);
        expect(screen.getByText('-2')).toBeInTheDocument();
    });

    it('does not render octave badge when octaveOffset is 0', () => {
        renderEditor([makeStep({ octaveOffset: 0 })]);
        expect(screen.queryByText('+0')).toBeNull();
    });

    it('cycles octave when badge clicked (1 → 2)', () => {
        const onStepChange = vi.fn();
        renderEditor([makeStep({ octaveOffset: 1 })], { onStepChange });
        fireEvent.click(screen.getByText('+1'));
        expect(onStepChange).toHaveBeenCalledWith(0, expect.objectContaining({ octaveOffset: 2 }));
    });

    it('wraps octave from +2 back to -2', () => {
        const onStepChange = vi.fn();
        renderEditor([makeStep({ octaveOffset: 2 })], { onStepChange });
        fireEvent.click(screen.getByText('+2'));
        expect(onStepChange).toHaveBeenCalledWith(0, expect.objectContaining({ octaveOffset: -2 }));
    });
});

describe('StepPatternEditor — ratchet indicator', () => {
    it('shows ×2 ratchet indicator when ratchet > 1', () => {
        renderEditor([makeStep({ ratchet: 2 })]);
        expect(screen.getByText('×2')).toBeInTheDocument();
    });

    it('does not show ratchet indicator when ratchet === 1', () => {
        renderEditor([makeStep({ ratchet: 1 })]);
        expect(screen.queryByText('×1')).toBeNull();
    });
});

describe('StepPatternEditor — add step button', () => {
    it('renders a + button to add steps', () => {
        renderEditor([makeStep()]);
        // The add-step button is the one with "+" text that's NOT in the length control row.
        const plusButtons = screen.getAllByText('+');
        expect(plusButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('calls onLengthChange(N+1) when add-step clicked', () => {
        const onLengthChange = vi.fn();
        renderEditor([makeStep(), makeStep()], { onLengthChange });
        // The first + button is the add-step one (the second is in length control).
        const plusButtons = screen.getAllByText('+');
        fireEvent.click(plusButtons[0]!);
        expect(onLengthChange).toHaveBeenCalledWith(3);
    });
});
