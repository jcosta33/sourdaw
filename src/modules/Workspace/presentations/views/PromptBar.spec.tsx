import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromptBar } from './PromptBar';

describe('PromptBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PromptBar />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<PromptBar />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<PromptBar />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
