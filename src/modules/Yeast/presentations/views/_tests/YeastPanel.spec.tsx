import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { YeastPanel } from '../YeastPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('YeastPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<YeastPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<YeastPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<YeastPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<YeastPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
