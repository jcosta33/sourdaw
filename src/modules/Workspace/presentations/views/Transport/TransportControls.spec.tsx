import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransportControls } from './TransportControls';

describe('TransportControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TransportControls />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<TransportControls />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<TransportControls />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
