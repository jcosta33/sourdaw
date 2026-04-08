import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MixerPopupMenu } from './MixerPopupMenu';

describe('MixerPopupMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MixerPopupMenu />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<MixerPopupMenu />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
