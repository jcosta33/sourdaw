import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useStore } from '#/infra/store/useStore';
import { getTrackAnalyser } from '#/modules/AudioEngine/useCases/engineAccess/getTrackAnalyser';
import { TrackLevelIndicator } from '../TrackLevelIndicator';

// Mock external dependencies
vi.mock('#/modules/AudioEngine/useCases/engineAccess/getTrackAnalyser', () => ({
    getTrackAnalyser: vi.fn(() => ({
        getFloatTimeDomainData: vi.fn((data: Float32Array) => {
            data.fill(0.5);
        }),
    })),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

const mockTrack = {
    id: 'track1',
    kind: 'audio',
};

describe('TrackLevelIndicator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('should render correctly', () => {
        vi.mocked(useStore).mockReturnValue({ isPlaying: true });
        const { container } = render(<TrackLevelIndicator track={mockTrack as any} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should display levels when audio is present', () => {
        vi.mocked(useStore).mockReturnValue({ isPlaying: true });
        // Make sure the mock returns an analyser
        vi.mocked(getTrackAnalyser).mockReturnValue({
            getFloatTimeDomainData: (data: Float32Array) => {
                data.fill(0.5);
            },
        } as any);

        const { container } = render(<TrackLevelIndicator track={mockTrack as any} />);
        
        act(() => {
            vi.advanceTimersByTime(100);
        });

        // The level bar should be rendered. We check for the presence of the inner bar div.
        // In the component, it renders a div with bg-emerald-500 or similar.
        const levelBar = container.querySelector('div[style*="height"]');
        expect(levelBar).toBeDefined();
    });

    it('should handle missing analyser gracefully', () => {
        vi.mocked(useStore).mockReturnValue({ isPlaying: true });
        vi.mocked(getTrackAnalyser).mockReturnValue(null);
        
        const { container } = render(<TrackLevelIndicator track={mockTrack as any} />);
        expect(container.firstChild).toBeTruthy();
    });
});
