import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnlineSampleBrowser } from './OnlineSampleBrowser';

describe('OnlineSampleBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<OnlineSampleBrowser />);
        expect(document.body).toBeTruthy();
    });
});
