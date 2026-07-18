import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixerLevelReadout } from '../MixerLevelReadout';

describe('MixerLevelReadout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MixerLevelReadout trackId={null} control={null} value={null} />);
        expect(document.body).toBeTruthy();
    });
});
