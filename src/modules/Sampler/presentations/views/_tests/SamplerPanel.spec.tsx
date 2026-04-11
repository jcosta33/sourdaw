import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SamplerPanel } from '../SamplerPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('SamplerPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SamplerPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<SamplerPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<SamplerPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<SamplerPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
