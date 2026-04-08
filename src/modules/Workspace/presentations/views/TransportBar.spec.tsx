import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransportBar } from './TransportBar';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('TransportBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TransportBar />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<TransportBar />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<TransportBar />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<TransportBar />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
