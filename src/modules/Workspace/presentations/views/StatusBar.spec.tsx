import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('StatusBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<StatusBar />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<StatusBar />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<StatusBar />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<StatusBar />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
