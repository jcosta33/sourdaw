import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofLimiterSection } from './ProofLimiterSection';
import { DEFAULT_PATCH } from '../../models/ProofPatch';

describe('ProofLimiterSection', () => {
    it('should render', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
        );
        expect(screen.getByText(/limiter/i)).toBeInTheDocument();
    });
});
