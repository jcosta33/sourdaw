import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OnlineSampleBrowser } from '../OnlineSampleBrowser';

describe('OnlineSampleBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<OnlineSampleBrowser />);
        expect(document.body).toBeTruthy();
    });
});
