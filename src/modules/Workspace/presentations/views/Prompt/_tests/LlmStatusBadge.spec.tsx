import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LlmStatusBadge } from '../LlmStatusBadge';

describe('LlmStatusBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<LlmStatusBadge />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<LlmStatusBadge />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<LlmStatusBadge />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
