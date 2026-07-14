import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofImagerSection } from '../ProofImagerSection';

describe('ProofImagerSection', () => {
    it('should render', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/stereo imager/i)).toBeInTheDocument();
    });
});
