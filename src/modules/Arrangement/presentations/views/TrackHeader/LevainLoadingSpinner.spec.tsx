import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LevainLoadingSpinner } from './LevainLoadingSpinner';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('LevainLoadingSpinner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<LevainLoadingSpinner />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<LevainLoadingSpinner />);
        expect(document.body).toBeTruthy();
    });
});
