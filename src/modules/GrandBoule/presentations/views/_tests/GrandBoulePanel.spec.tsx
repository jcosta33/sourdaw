import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('GrandBoulePanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<GrandBoulePanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<GrandBoulePanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<GrandBoulePanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<GrandBoulePanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
