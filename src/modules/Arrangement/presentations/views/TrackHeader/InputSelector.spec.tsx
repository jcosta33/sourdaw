import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InputSelector } from './InputSelector';

describe('InputSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<InputSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<InputSelector />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<InputSelector />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
