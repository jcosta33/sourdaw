import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StepSequencerEditor } from '../StepSequencerEditor';

describe('StepSequencerEditor', () => {
    it('should render', () => {
        const { container } = render(
            <StepSequencerEditor
                width={200}
                height={48}
                steps={Array.from({ length: 8 }, () => 0.5)}
                numSteps={8}
                onStepsChange={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    // Regression: the buffer is sized to numSteps and the local state re-syncs when
    // the controlled initialSteps prop changes. Previously the init-once useState
    // never re-synced, so after the parent swapped in a new pattern an edit would
    // commit the STALE baseline for every untouched step.
    it('re-syncs internal state when the controlled steps prop changes', () => {
        const onStepsChange = vi.fn();
        const { container, rerender } = render(
            <StepSequencerEditor
                width={200}
                height={48}
                steps={Array.from({ length: 8 }, () => 0.1)}
                numSteps={8}
                onStepsChange={onStepsChange}
            />
        );

        // Parent swaps in a new pattern (all 0.9) with the same step count.
        rerender(
            <StepSequencerEditor
                width={200}
                height={48}
                steps={Array.from({ length: 8 }, () => 0.9)}
                numSteps={8}
                onStepsChange={onStepsChange}
            />
        );

        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 48,
            right: 200,
            bottom: 48,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        // Edit only step 0; commit on pointerUp.
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        const committed = onStepsChange.mock.calls.at(-1)![0] as number[];
        // Untouched steps must reflect the NEW baseline (0.9), not the stale 0.1.
        expect(committed[7]).toBeCloseTo(0.9, 5);
        expect(committed[3]).toBeCloseTo(0.9, 5);
    });

    // Regression: re-syncs and re-sizes when numSteps changes (label reads numSteps,
    // internal buffer must follow it too).
    it('renders an updated step count after numSteps changes', () => {
        const { getByText, rerender } = render(
            <StepSequencerEditor
                width={200}
                height={48}
                steps={Array.from({ length: 8 }, () => 0.5)}
                numSteps={8}
                onStepsChange={vi.fn()}
            />
        );
        expect(getByText('Step Sequencer (8 steps)')).toBeInTheDocument();

        rerender(<StepSequencerEditor width={400} height={48} steps={[]} numSteps={40} onStepsChange={vi.fn()} />);
        expect(getByText('Step Sequencer (40 steps)')).toBeInTheDocument();
    });

    // Regression: an in-progress edit must survive a parent re-render that passes a
    // fresh-but-content-equal `steps` literal. The live mount passes `steps={[]}` —
    // a new array identity every render — so a re-sync keyed on array identity would
    // re-fire on the re-render and clobber the half-drawn edit. Keying the re-sync on
    // the content signature (numSteps + values) leaves the edit intact.
    it('does not clobber an in-progress edit when the parent re-renders with a new but content-equal steps array', () => {
        const onStepsChange = vi.fn();
        const view = (
            <StepSequencerEditor width={200} height={48} steps={[]} numSteps={8} onStepsChange={onStepsChange} />
        );
        const { container, rerender } = render(view);

        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 48,
            right: 200,
            bottom: 48,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        // Begin drawing and edit step 0 near the top (value ≈ +1), without committing.
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });

        // Parent re-renders with a BRAND-NEW empty literal (same content as before).
        rerender(<StepSequencerEditor width={200} height={48} steps={[]} numSteps={8} onStepsChange={onStepsChange} />);

        // Commit the gesture.
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        const committed = onStepsChange.mock.calls.at(-1)![0] as number[];
        // The edited step must retain the drawn value, not be reset to the baseline 0.
        expect(committed[0]).toBeCloseTo(1, 5);
    });

    // Regression: a cancelled gesture clears the drawing flag so a later stray move
    // does not keep painting steps.
    it('clears the drawing state on pointercancel', () => {
        const onStepsChange = vi.fn();
        const { container } = render(
            <StepSequencerEditor width={200} height={48} steps={[]} numSteps={8} onStepsChange={onStepsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 200,
            height: 48,
            right: 200,
            bottom: 48,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        // Move after cancel must not commit on the following up.
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 40, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        // pointerUp only commits while drawing; cancel cleared it.
        expect(onStepsChange).not.toHaveBeenCalled();
    });
});
