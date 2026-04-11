import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackInspector } from '../TrackInspector';
import type { Track } from '../../../../models/TrackViewTypes';

// Mock all child components
vi.mock('../TrackHeaderSection', () => ({
    TrackHeaderSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-header-section">Header: {track.name}</div>
    ),
}));

vi.mock('../TrackAlternativesSection', () => ({
    TrackAlternativesSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-alternatives-section">Alternatives: {track.name}</div>
    ),
}));

vi.mock('../TrackLevelSection', () => ({
    TrackLevelSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-level-section">Level: {track.name}</div>
    ),
}));

vi.mock('../TrackDevicesSection', () => ({
    TrackDevicesSection: ({ track, onSelectDevice }: { track: { name: string }; onSelectDevice: (id: string) => void }) => (
        <div data-testid="track-devices-section">Devices: {track.name}</div>
    ),
}));

vi.mock('../TrackAutomationSection', () => ({
    TrackAutomationSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-automation-section">Automation: {track.name}</div>
    ),
}));

vi.mock('../SendsEditor', () => ({
    SendsEditor: ({ track }: { track: { name: string } }) => (
        <div data-testid="sends-editor">Sends: {track.name}</div>
    ),
}));

vi.mock('../TrackVcaSection', () => ({
    TrackVcaSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-vca-section">VCA: {track.name}</div>
    ),
}));

vi.mock('../TrackMidiOutputSection', () => ({
    TrackMidiOutputSection: ({ track, allTracks }: { track: { name: string }; allTracks: unknown[] }) => (
        <div data-testid="track-midi-output-section">MIDI Output: {track.name}</div>
    ),
}));

vi.mock('../TrackRoutingSection', () => ({
    TrackRoutingSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-routing-section">Routing: {track.name}</div>
    ),
}));

vi.mock('../TrackLatencySection', () => ({
    TrackLatencySection: ({ trackId }: { trackId: string }) => (
        <div data-testid="track-latency-section">Latency: {trackId}</div>
    ),
}));

vi.mock('../TrackClipsSection', () => ({
    TrackClipsSection: ({ track, onSelectClip }: { track: { name: string }; onSelectClip: (id: string) => void }) => (
        <div data-testid="track-clips-section">Clips: {track.name}</div>
    ),
}));

vi.mock('../TakesSection', () => ({
    TakesSection: ({ trackId }: { trackId: string }) => (
        <div data-testid="takes-section">Takes: {trackId}</div>
    ),
}));

vi.mock('../MasterVisualizationsSection', () => ({
    MasterVisualizationsSection: () => <div data-testid="master-visualizations-section">Master Visualizations</div>,
}));

vi.mock('../SignalFlowSection', () => ({
    SignalFlowSection: () => <div data-testid="signal-flow-section">Signal Flow</div>,
}));

vi.mock('../TrackNotesSection', () => ({
    TrackNotesSection: ({ track }: { track: { name: string } }) => (
        <div data-testid="track-notes-section">Notes: {track.name}</div>
    ),
}));

describe('TrackInspector', () => {
    const mockOnSelectClip = vi.fn();
    const mockOnSelectDevice = vi.fn();

    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    const mockAllTracks: Track[] = [mockTrack];

    it('should render without crashing', () => {
        render(
            <TrackInspector
                track={mockTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.getByTestId('track-header-section')).toBeInTheDocument();
    });

    it('should render all sections for audio track', () => {
        render(
            <TrackInspector
                track={mockTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.getByTestId('track-header-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-alternatives-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-level-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-devices-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-automation-section')).toBeInTheDocument();
        expect(screen.getByTestId('sends-editor')).toBeInTheDocument();
        expect(screen.getByTestId('track-vca-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-routing-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-latency-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-clips-section')).toBeInTheDocument();
        expect(screen.getByTestId('takes-section')).toBeInTheDocument();
        expect(screen.getByTestId('signal-flow-section')).toBeInTheDocument();
        expect(screen.getByTestId('track-notes-section')).toBeInTheDocument();
    });

    it('should not render MIDI output section for audio track', () => {
        render(
            <TrackInspector
                track={mockTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.queryByTestId('track-midi-output-section')).not.toBeInTheDocument();
    });

    it('should render MIDI output section for midi track', () => {
        const midiTrack = { ...mockTrack, kind: 'midi' as const };
        render(
            <TrackInspector
                track={midiTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.getByTestId('track-midi-output-section')).toBeInTheDocument();
    });

    it('should render master visualizations for master track', () => {
        const masterTrack = { ...mockTrack, kind: 'master' as const };
        render(
            <TrackInspector
                track={masterTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.getByTestId('master-visualizations-section')).toBeInTheDocument();
    });

    it('should not render master visualizations for non-master track', () => {
        render(
            <TrackInspector
                track={mockTrack}
                allTracks={mockAllTracks}
                onSelectClip={mockOnSelectClip}
                onSelectDevice={mockOnSelectDevice}
            />
        );
        expect(screen.queryByTestId('master-visualizations-section')).not.toBeInTheDocument();
    });
});
