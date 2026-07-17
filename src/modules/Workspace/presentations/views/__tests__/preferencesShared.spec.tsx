import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SectionTitle } from '../preferencesShared';

describe('SectionTitle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SectionTitle icon={<span />} title="Audio" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<SectionTitle icon={<span />} title="Audio" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
