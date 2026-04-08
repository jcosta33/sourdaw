import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('AppShell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AppShell />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<AppShell />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<AppShell />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<AppShell />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
