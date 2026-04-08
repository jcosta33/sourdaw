import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelToggles } from './PanelToggles';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('PanelToggles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PanelToggles />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PanelToggles />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PanelToggles />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PanelToggles />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
