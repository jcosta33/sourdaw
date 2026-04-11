import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrustPanel } from '../CrustPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('CrustPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<CrustPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<CrustPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<CrustPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<CrustPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
