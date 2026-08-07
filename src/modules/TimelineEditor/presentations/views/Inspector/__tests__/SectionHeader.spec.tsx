import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SectionHeader } from '../SectionHeader';

// SectionHeader's whole contract is what it hands DawHeaderBand: the caller's
// title, and `compact` regardless of the caller. The real band expresses
// `compact` only through padding utility classes, which are not a behaviour
// worth asserting, so the band is mocked to expose the props it receives.
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact }: { title?: string; compact?: boolean }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
        </div>
    ),
}));

describe('SectionHeader', () => {
    it('passes the caller title through to the header band', () => {
        render(<SectionHeader title="Test Section" />);
        expect(screen.getByTestId('header-band')).toHaveTextContent('Test Section');
    });

    it('always renders the band in compact mode', () => {
        render(<SectionHeader title="Test Section" />);
        expect(screen.getByTestId('header-band')).toHaveAttribute('data-compact', 'true');
    });
});
