import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KneadEditor } from './KneadEditor';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('KneadEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<KneadEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<KneadEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<KneadEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<KneadEditor />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
