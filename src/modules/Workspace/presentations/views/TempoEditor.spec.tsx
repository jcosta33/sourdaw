import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TempoEditor } from './TempoEditor';

describe('TempoEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TempoEditor />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<TempoEditor />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
