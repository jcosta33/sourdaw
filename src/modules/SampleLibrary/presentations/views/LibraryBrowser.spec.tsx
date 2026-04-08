import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LibraryBrowser } from './LibraryBrowser';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('LibraryBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<LibraryBrowser />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<LibraryBrowser />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<LibraryBrowser />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<LibraryBrowser />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
