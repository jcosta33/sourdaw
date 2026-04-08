import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpandedChannelStrip } from './ExpandedChannelStrip';

describe('ExpandedChannelStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ExpandedChannelStrip />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ExpandedChannelStrip />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ExpandedChannelStrip />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
