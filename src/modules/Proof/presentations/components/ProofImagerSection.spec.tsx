import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofImagerSection } from './ProofImagerSection';
import { DEFAULT_PATCH } from '../../models/ProofPatch';

describe('ProofImagerSection', () => {
    it('should render', () => {
        render(
            <ProofImagerSection
                patch={DEFAULT_PATCH}
                correlation={0.5}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
        );
        expect(screen.getByText(/stereo imager/i)).toBeInTheDocument();
    });
});
