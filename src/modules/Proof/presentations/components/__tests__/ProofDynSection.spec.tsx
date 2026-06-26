import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofDynSection } from '../ProofDynSection';

describe('ProofDynSection', () => {
    it('should render', () => {
        render(
            <ProofDynSection patch={DEFAULT_PATCH} dynGr={[0, 0, 0, 0]} onPatchChange={vi.fn()} onSendParam={vi.fn()} />
        );
        expect(screen.getByText(/multiband dynamics/i)).toBeInTheDocument();
    });

    it("colours each band's GR meter bar with that band's own colour, not a constant", () => {
        // Non-zero GR on every band so each bar has a visible width and a colour to read.
        const { container } = render(
            <ProofDynSection
                patch={DEFAULT_PATCH}
                dynGr={[-3, -3, -3, -3]}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
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
});
