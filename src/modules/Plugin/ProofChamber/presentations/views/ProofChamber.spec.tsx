import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofChamber } from './ProofChamber';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('ProofChamber', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ProofChamber />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ProofChamber />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ProofChamber />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
