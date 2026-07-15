import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatchEdit } from '../../../models/ProofPatch';
import { isValidDynCrossoverFreqs } from '../../../services/isValidDynCrossoverFreqs';
import { ProofDynSection } from '../ProofDynSection';

describe('ProofDynSection', () => {
    it('should render', () => {
        render(<ProofDynSection patch={DEFAULT_PATCH} dynGr={[0, 0, 0, 0]} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/multiband dynamics/i)).toBeInTheDocument();
    });

    it('names crossover and repeated band controls with their band identity', () => {
        render(<ProofDynSection patch={DEFAULT_PATCH} dynGr={[0, 0, 0, 0]} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'Dynamics low crossover frequency',
            'Dynamics mid crossover frequency',
            'Dynamics high crossover frequency',
            'Dynamics Sub threshold',
            'Dynamics Sub ratio',
            'Dynamics Sub attack',
            'Dynamics Sub release',
            'Dynamics Low-Mid threshold',
            'Dynamics Low-Mid ratio',
            'Dynamics Low-Mid attack',
            'Dynamics Low-Mid release',
            'Dynamics Hi-Mid threshold',
            'Dynamics Hi-Mid ratio',
            'Dynamics Hi-Mid attack',
            'Dynamics Hi-Mid release',
            'Dynamics High threshold',
            'Dynamics High ratio',
            'Dynamics High attack',
            'Dynamics High release',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives the module bypass toggle a contextual name and pressed state', () => {
        render(<ProofDynSection patch={DEFAULT_PATCH} dynGr={[0, 0, 0, 0]} gestureOwner={0} onPatchChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Dynamics module' })).toHaveAttribute(
            'aria-pressed',
            String(!DEFAULT_PATCH.dynBypassed)
        );
    });

    it("colours each band's GR meter bar with that band's own colour, not a constant", () => {
        // Non-zero GR on every band so each bar has a visible width and a colour to read.
        const { container } = render(
            <ProofDynSection patch={DEFAULT_PATCH} dynGr={[-3, -3, -3, -3]} gestureOwner={0} onPatchChange={vi.fn()} />
        );

        // The four GR bars are the only elements carrying the metering transition class.
        const bars = Array.from(container.querySelectorAll<HTMLElement>('.transition-all.duration-75'));
        expect(bars).toHaveLength(4);

        // Each bar must match its band label's colour (peach/mint/cyan/lavender), so the
        // bar identifies the same band as the label above it — not all peach.
        const expected = [
            'var(--color-accent-peach)',
            'var(--color-accent-mint)',
            'var(--color-accent-cyan)',
            'var(--color-accent-lavender)',
        ];
        const actual = bars.map((bar) => bar.style.backgroundColor);
        expect(actual).toEqual(expected);
    });

    it('keeps every crossover preview and commit strictly ordered', () => {
        const onPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
        const { container } = render(
            <ProofDynSection
                patch={DEFAULT_PATCH}
                dynGr={[0, 0, 0, 0]}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );
        const lowCrossover = container.querySelectorAll<HTMLElement>('.cursor-ns-resize')[0]!;

        fireEvent.pointerDown(lowCrossover, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(lowCrossover, { pointerId: 1, clientY: 98 });
        fireEvent.pointerMove(lowCrossover, { pointerId: 1, clientY: 93 });
        fireEvent.pointerUp(lowCrossover, { pointerId: 1 });

        const edits = onPatchChange.mock.calls.map(([edit]) => edit);
        expect(edits).toHaveLength(3);
        expect(edits.map((edit) => edit.key)).toEqual(['dynCrossoverFreqs', 'dynCrossoverFreqs', 'dynCrossoverFreqs']);
        expect(edits.map((edit) => edit.isTransient)).toEqual([true, true, false]);
        expect(edits.every((edit) => edit.key === 'dynCrossoverFreqs' && isValidDynCrossoverFreqs(edit.value))).toBe(
            true
        );
    });
});
