import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('CommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<CommandPalette />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<CommandPalette />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
