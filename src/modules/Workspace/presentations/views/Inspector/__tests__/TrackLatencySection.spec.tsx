import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackLatencySection } from '../TrackLatencySection';

// Mock external dependencies
const mockGetTrackLatency = vi.fn(() => ({ totalLatencyMs: 0, deviceLatencyMs: 0 }));
const mockGetCompensationDelay = vi.fn(() => 0);

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        getCompensationDelay: () => mockGetCompensationDelay(),
        getTrackLatency: () => mockGetTrackLatency(),
    };
});

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/daw/DawReadoutRow', () => ({
    DawReadoutRow: ({ label, value }: { label: string; value: string }) => (
        <div data-testid="readout-row">
            <span>{label}</span>
            <span>{value}</span>
        </div>
    ),
}));

describe('TrackLatencySection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackLatencySection trackId="track-1" />);
        expect(screen.getByText('Latency')).toBeInTheDocument();
    });

    it('should show empty state when no latency exists', () => {
        mockGetTrackLatency.mockReturnValue({ totalLatencyMs: 0, deviceLatencyMs: 0 });
        mockGetCompensationDelay.mockReturnValue(0);
        render(<TrackLatencySection trackId="track-1" />);
        expect(screen.getByText(/No latency reported/i)).toBeInTheDocument();
    });

    it('should display device latency when it exists', () => {
        mockGetTrackLatency.mockReturnValue({ totalLatencyMs: 10, deviceLatencyMs: 5 });
        mockGetCompensationDelay.mockReturnValue(0);
        render(<TrackLatencySection trackId="track-1" />);
        expect(screen.getByText('Device chain')).toBeInTheDocument();
        expect(screen.getByText('5.00 ms')).toBeInTheDocument();
    });

    it('should display PDC delay when compensation exists', () => {
        mockGetTrackLatency.mockReturnValue({ totalLatencyMs: 0, deviceLatencyMs: 0 });
        mockGetCompensationDelay.mockReturnValue(0.01);
        render(<TrackLatencySection trackId="track-1" />);
        expect(screen.getByText('PDC delay')).toBeInTheDocument();
        expect(screen.getByText('+10.00 ms')).toBeInTheDocument();
    });

    it('should display both latencies when both exist', () => {
        mockGetTrackLatency.mockReturnValue({ totalLatencyMs: 15, deviceLatencyMs: 5 });
        mockGetCompensationDelay.mockReturnValue(0.01);
        render(<TrackLatencySection trackId="track-1" />);
        const readoutRows = screen.getAllByTestId('readout-row');
        expect(readoutRows.length).toBe(2);
    });
});
