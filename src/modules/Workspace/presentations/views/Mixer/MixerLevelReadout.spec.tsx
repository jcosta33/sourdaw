import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MixerLevelReadout } from './MixerLevelReadout';

describe('MixerLevelReadout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MixerLevelReadout />);
        expect(document.body).toBeTruthy();
    });
});
