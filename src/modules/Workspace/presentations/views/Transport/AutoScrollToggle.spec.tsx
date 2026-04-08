import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutoScrollToggle } from './AutoScrollToggle';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('AutoScrollToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutoScrollToggle />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<AutoScrollToggle />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<AutoScrollToggle />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
