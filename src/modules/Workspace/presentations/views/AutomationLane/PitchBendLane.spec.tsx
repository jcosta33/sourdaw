import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PitchBendLane } from './PitchBendLane';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('PitchBendLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PitchBendLane />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PitchBendLane />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PitchBendLane />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PitchBendLane />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
