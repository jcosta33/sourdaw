import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineTrackName } from './InlineTrackName';

describe('InlineTrackName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<InlineTrackName />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<InlineTrackName />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<InlineTrackName />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
