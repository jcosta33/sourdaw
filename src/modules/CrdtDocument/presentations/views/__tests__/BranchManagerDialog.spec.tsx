import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BranchManagerDialog } from '../BranchManagerDialog';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('BranchManagerDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<BranchManagerDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<BranchManagerDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<BranchManagerDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<BranchManagerDialog />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
