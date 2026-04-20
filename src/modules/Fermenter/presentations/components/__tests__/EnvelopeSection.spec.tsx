import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { EnvelopeSection } from '../EnvelopeSection';

describe('EnvelopeSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <EnvelopeSection
                ampA={p.ampAttack}
                ampD={p.ampDecay}
                ampS={p.ampSustain}
                ampR={p.ampRelease}
                filterA={p.filterAttack}
                filterD={p.filterDecay}
                filterS={p.filterSustain}
                filterR={p.filterRelease}
                onAmpChange={vi.fn()}
                onFilterChange={vi.fn()}
            />
        );
        expect(screen.getByText(/envelope/i)).toBeInTheDocument();
    });
});
