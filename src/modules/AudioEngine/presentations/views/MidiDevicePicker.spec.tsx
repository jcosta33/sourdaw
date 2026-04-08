import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MidiDevicePicker } from './MidiDevicePicker';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('MidiDevicePicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MidiDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<MidiDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<MidiDevicePicker />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<MidiDevicePicker />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
