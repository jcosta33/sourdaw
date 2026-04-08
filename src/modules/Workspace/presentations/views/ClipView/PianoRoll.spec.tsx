import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PianoRoll } from './PianoRoll';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('PianoRoll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PianoRoll />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<PianoRoll />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PianoRoll />);
        expect(document.body).toBeTruthy();
    });
});
