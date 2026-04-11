import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdditiveSection } from '../AdditiveSection';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

describe('AdditiveSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <AdditiveSection
                partials={p.additivePartials}
                tilt={p.additiveTilt}
                oddEmphasis={p.additiveOdd}
                inharmonicity={p.additiveInharm}
                onParam={vi.fn()}
            />
        );
        expect(screen.getByText(/additive/i)).toBeInTheDocument();
    });
});
