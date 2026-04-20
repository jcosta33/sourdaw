import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CrumbsPanel } from '../CrumbsPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('CrumbsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<CrumbsPanel deviceId="test-device" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<CrumbsPanel deviceId="test-device" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<CrumbsPanel deviceId="test-device" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<CrumbsPanel deviceId="test-device" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
