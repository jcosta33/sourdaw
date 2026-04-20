import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixerLevelReadout } from '../MixerLevelReadout';

describe('MixerLevelReadout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MixerLevelReadout />);
        expect(document.body).toBeTruthy();
    });
});
