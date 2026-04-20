import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofEqSection } from '../ProofEqSection';

describe('ProofEqSection', () => {
    it('should render', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} onPatchChange={vi.fn()} onSendParam={vi.fn()} />);
        expect(screen.getAllByText('EQ').length).toBeGreaterThan(0);
    });
});
