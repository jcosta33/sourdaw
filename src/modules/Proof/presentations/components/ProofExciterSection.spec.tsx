import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofExciterSection } from './ProofExciterSection';
import { DEFAULT_PATCH } from '../../models/ProofPatch';

describe('ProofExciterSection', () => {
    it('should render', () => {
        render(
            <ProofExciterSection patch={DEFAULT_PATCH} onPatchChange={vi.fn()} onSendParam={vi.fn()} />
        );
        expect(screen.getByText(/harmonic exciter/i)).toBeInTheDocument();
    });
});
