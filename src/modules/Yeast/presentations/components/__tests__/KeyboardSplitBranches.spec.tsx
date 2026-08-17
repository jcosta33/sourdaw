import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { KeyboardSplit } from '../KeyboardSplit';

function renderKb(overrides: Record<string, unknown> = {}) {
    const { container } = render(
        <KeyboardSplit width={600} height={80} heldNotes={[]} soundingNotes={[]} {...overrides} />
    );
    return { container };
}

describe('KeyboardSplit — octave labels', () => {
    it('renders C2 through C6 octave labels', () => {
        renderKb();
        expect(screen.getByText('C2')).toBeInTheDocument();
        expect(screen.getByText('C3')).toBeInTheDocument();
        expect(screen.getByText('C4')).toBeInTheDocument();
        expect(screen.getByText('C5')).toBeInTheDocument();
        expect(screen.getByText('C6')).toBeInTheDocument();
    });

    it('does not render C1 (below range) or C7 (at range high)', () => {
        renderKb();
        expect(screen.queryByText('C1')).toBeNull();
        expect(screen.queryByText('C7')).toBeNull();
    });
});

describe('KeyboardSplit — key rendering', () => {
    it('renders white and black keys as absolutely positioned divs', () => {
        const { container } = renderKb();
        // The keyboard container is the first child with position relative
        const kb = container.firstChild as HTMLElement;
        const keyDivs = kb.querySelectorAll('div[style*="left"]');
        expect(keyDivs.length).toBeGreaterThan(20); // ~35 white + ~25 black keys
    });
});

describe('KeyboardSplit — sounding note coloring', () => {
    it('applies peach color to a sounding white key', () => {
        const { container } = renderKb({ soundingNotes: [60] }); // C4
        const kb = container.firstChild as HTMLElement;
        const keys = kb.querySelectorAll('div[style*="left"]');
        // At least one key should have the peach color applied
        const peachKeys = Array.from(keys).filter((k) => (k as HTMLElement).style.background.includes('peach'));
        expect(peachKeys.length).toBeGreaterThan(0);
    });
});

describe('KeyboardSplit — held note coloring', () => {
    it('applies lavender color to a held white key', () => {
        const { container } = renderKb({ heldNotes: [60] }); // C4
        const kb = container.firstChild as HTMLElement;
        const keys = kb.querySelectorAll('div[style*="left"]');
        const lavenderKeys = Array.from(keys).filter((k) => (k as HTMLElement).style.background.includes('lavender'));
        expect(lavenderKeys.length).toBeGreaterThan(0);
    });
});

describe('KeyboardSplit — default empty state', () => {
    it('renders without crashing with no held/sounding notes', () => {
        expect(() => renderKb()).not.toThrow();
    });
});
