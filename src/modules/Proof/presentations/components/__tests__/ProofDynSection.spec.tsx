import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofDynSection } from '../ProofDynSection';

describe('ProofDynSection', () => {
    it('should render', () => {
        render(
            <ProofDynSection patch={DEFAULT_PATCH} dynGr={[0, 0, 0, 0]} onPatchChange={vi.fn()} onSendParam={vi.fn()} />
        );
        expect(screen.getByText(/multiband dynamics/i)).toBeInTheDocument();
    });
});
