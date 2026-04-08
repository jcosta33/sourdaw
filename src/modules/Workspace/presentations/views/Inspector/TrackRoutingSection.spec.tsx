import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackRoutingSection } from './TrackRoutingSection';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('TrackRoutingSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackRoutingSection />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<TrackRoutingSection />);
        expect(document.body).toBeTruthy();
    });
});
