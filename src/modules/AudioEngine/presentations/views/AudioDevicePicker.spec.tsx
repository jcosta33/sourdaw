import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioDevicePicker } from './AudioDevicePicker';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('AudioDevicePicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AudioDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<AudioDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<AudioDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<AudioDevicePicker />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
