import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofDynSection } from '../ProofDynSection';
import { DEFAULT_PATCH } from '../../../models/ProofPatch';

describe('ProofDynSection', () => {
    it('should render', () => {
        render(
            <ProofDynSection
                patch={DEFAULT_PATCH}
                dynGr={[0, 0, 0, 0]}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
        );
        expect(screen.getByText(/multiband dynamics/i)).toBeInTheDocument();
    });
});
