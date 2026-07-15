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
});
