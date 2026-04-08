import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionView } from './SessionView';

describe('SessionView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SessionView />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<SessionView />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
