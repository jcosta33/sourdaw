import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofExciterSection } from '../ProofExciterSection';

describe('ProofExciterSection', () => {
    it('should render', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/harmonic exciter/i)).toBeInTheDocument();
    });
});
