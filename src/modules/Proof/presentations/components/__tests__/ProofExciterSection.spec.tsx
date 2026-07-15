import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofExciterSection } from '../ProofExciterSection';

describe('ProofExciterSection', () => {
    it('should render', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/harmonic exciter/i)).toBeInTheDocument();
    });

    it('names each repeated exciter control with its band identity', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'Exciter Sub drive',
            'Exciter Sub blend',
            'Exciter Low-Mid drive',
            'Exciter Low-Mid blend',
            'Exciter Hi-Mid drive',
            'Exciter Hi-Mid blend',
            'Exciter High drive',
            'Exciter High blend',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });
});
