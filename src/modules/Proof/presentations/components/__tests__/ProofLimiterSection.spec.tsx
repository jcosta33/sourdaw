import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofLimiterSection } from '../ProofLimiterSection';

describe('ProofLimiterSection', () => {
    it('should render', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        expect(screen.getByText(/limiter/i)).toBeInTheDocument();
    });

    it('gives each limiter control a meaningful accessible name', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual(['Limiter ceiling', 'Limiter release', 'Limiter lookahead']);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives the module bypass toggle a contextual name and pressed state', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: 'Limiter module' })).toHaveAttribute(
            'aria-pressed',
            String(!DEFAULT_PATCH.limBypassed)
        );
    });
});
