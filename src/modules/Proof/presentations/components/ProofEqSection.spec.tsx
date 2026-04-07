import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofEqSection } from './ProofEqSection';
import { DEFAULT_PATCH } from '../../models/ProofPatch';

describe('ProofEqSection', () => {
    it('should render', () => {
        render(
            <ProofEqSection patch={DEFAULT_PATCH} onPatchChange={vi.fn()} onSendParam={vi.fn()} />
        );
        expect(screen.getAllByText('EQ').length).toBeGreaterThan(0);
    });
});
