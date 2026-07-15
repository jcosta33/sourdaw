import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofImagerSection } from '../ProofImagerSection';

describe('ProofImagerSection', () => {
    it('should render', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/stereo imager/i)).toBeInTheDocument();
    });

    it('names each repeated imager control with its band identity', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'Imager Sub width',
            'Imager Low-Mid width',
            'Imager Hi-Mid width',
            'Imager High width',
            'Imager auto mono bass frequency',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });
});
