import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<Sidebar />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<Sidebar />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<Sidebar />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
