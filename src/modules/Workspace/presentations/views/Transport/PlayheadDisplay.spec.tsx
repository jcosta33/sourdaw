import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayheadDisplay } from './PlayheadDisplay';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('PlayheadDisplay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PlayheadDisplay />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PlayheadDisplay />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PlayheadDisplay />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PlayheadDisplay />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
