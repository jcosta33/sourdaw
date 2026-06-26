import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { LevainLoadingSpinner } from '../LevainLoadingSpinner';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('#/modules/Levain/stores/levainStore', () => ({
    levainStore: {},
    // The component now imports the canonical defaultLevainState from the Levain
    // stores barrel (re-exported from levainStore); provide it so the
    // no-device / fallback path has a defined idle state to read.
    defaultLevainState: { sampleLoadProgress: null, engineReady: false },
}));

const LEVAIN_DEVICE_ID = 'levain-device-1';

const mockTrackWithLevain = {
    id: 'track1',
    name: 'Levain Track',
    devices: [{ id: LEVAIN_DEVICE_ID, type: 'levain' }],
};

const mockTrackWithoutLevain = {
    id: 'track2',
    name: 'Regular Track',
    devices: [{ id: 'other-device-1', type: 'other' }],
};

function loadingInstances(): Record<string, { sampleLoadProgress: number | null; engineReady: boolean }> {
    return { [LEVAIN_DEVICE_ID]: { sampleLoadProgress: 50, engineReady: false } };
}

function idleInstances(): Record<string, { sampleLoadProgress: number | null; engineReady: boolean }> {
    return { [LEVAIN_DEVICE_ID]: { sampleLoadProgress: null, engineReady: true } };
}

describe('LevainLoadingSpinner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render null when track has no levain device', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithoutLevain} />);
        expect(container.firstChild).toBeNull();
    });

    it('should render null when not loading', () => {
        vi.mocked(useStore).mockReturnValue(idleInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        expect(container.firstChild).toBeNull();
    });

    it('should render spinner when loading', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have animate-spin class', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
    });

    it('should have aria-hidden attribute', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        const spinner = container.querySelector('[aria-hidden="true"]');
        expect(spinner).toBeInTheDocument();
    });

    it('should have aria-label for accessibility', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        const spinner = container.querySelector('[aria-label="Loading Orchestral Samples"]');
        expect(spinner).toBeInTheDocument();
    });

    it('should have correct color', () => {
        vi.mocked(useStore).mockReturnValue(loadingInstances());
        const { container } = render(<LevainLoadingSpinner track={mockTrackWithLevain} />);
        const spinner = container.querySelector('.text-\\[var\\(--color-accent-amber\\)\\]');
        expect(spinner).toBeInTheDocument();
    });
});
