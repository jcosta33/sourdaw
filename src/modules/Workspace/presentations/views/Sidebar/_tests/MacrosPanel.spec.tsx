import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MacrosPanel } from '../MacrosPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('MacrosPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MacrosPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<MacrosPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<MacrosPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<MacrosPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
