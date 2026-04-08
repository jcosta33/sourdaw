import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackInspector } from './TrackInspector';

describe('TrackInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackInspector />);
        expect(document.body).toBeTruthy();
    });
});
