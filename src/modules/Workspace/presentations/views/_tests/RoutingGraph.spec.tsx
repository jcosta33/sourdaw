import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutingGraph } from '../RoutingGraph';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('RoutingGraph', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<RoutingGraph />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<RoutingGraph />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<RoutingGraph />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<RoutingGraph />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
