import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackLevelSection } from '../TrackLevelSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockSetTrackGain = vi.fn();
const mockSetTrackPan = vi.fn();

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackNotes', () => ({
    setTrackNotes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackColor', () => ({
    setTrackColor: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackPan', () => ({
    setTrackPan: (...args: unknown[]) => mockSetTrackPan(...args),
}));

vi.mock('#/modules/Arrangement/useCases/setTrackGainPan/setTrackGain', () => ({
    setTrackGain: (...args: unknown[]) => mockSetTrackGain(...args),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (values: number[]) => void;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            data-testid="slider"
            data-label={ariaLabel}
            value={value[0]}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
        'aria-label': ariaLabel,
    }: {
        value: number;
        onChange: (v: number) => void;
        'aria-label'?: string;
    }) => (
        <button data-testid="rotary-knob" data-label={ariaLabel} data-value={value} onClick={() => onChange(value + 1)}>
            Knob
        </button>
    ),
}));

vi.mock('#/modules/MIDI/presentations/views', () => ({
    MidiLearnButton: ({ targetType }: { targetType: string }) => (
        <button data-testid="midi-learn-btn" data-target={targetType}>
            Learn
        </button>
    ),
}));

vi.mock('../../../components/Inspector/ControlHeader', () => ({
    ControlHeader: ({ label, value }: { label: string; value?: React.ReactNode }) => (
        <div data-testid="control-header">
            <span>{label}</span>
            {value ? <div data-testid="control-value">{value}</div> : null}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

describe('TrackLevelSection', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.75,
        pan: 10,
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

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackLevelSection track={mockTrack} />);
        expect(screen.getByText('Level')).toBeInTheDocument();
    });

    it('should render gain slider', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const slider = screen.getByTestId('slider');
        expect(slider).toBeInTheDocument();
        expect(slider).toHaveAttribute('data-label', 'Test Track gain');
    });

    it('should display gain percentage', () => {
        render(<TrackLevelSection track={mockTrack} />);
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('should render pan rotary knob', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const knob = screen.getByTestId('rotary-knob');
        expect(knob).toBeInTheDocument();
        expect(knob).toHaveAttribute('data-label', 'Test Track pan');
    });

    it('should display pan value with R for right', () => {
        render(<TrackLevelSection track={mockTrack} />);
        expect(screen.getByText('R10')).toBeInTheDocument();
    });

    it('should display pan value with L for left', () => {
        const leftPannedTrack = { ...mockTrack, pan: -20 };
        render(<TrackLevelSection track={leftPannedTrack} />);
        expect(screen.getByText('L20')).toBeInTheDocument();
    });

    it('should display C for center pan', () => {
        const centerTrack = { ...mockTrack, pan: 0 };
        render(<TrackLevelSection track={centerTrack} />);
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('should render MIDI learn buttons for gain and pan', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const midiLearnBtns = screen.getAllByTestId('midi-learn-btn');
        expect(midiLearnBtns.length).toBe(2);
        expect(midiLearnBtns[0]).toHaveAttribute('data-target', 'trackGain');
        expect(midiLearnBtns[1]).toHaveAttribute('data-target', 'trackPan');
    });

    it('should call setTrackGain when slider value changes', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const slider = screen.getByTestId('slider');
        fireEvent.change(slider, { target: { value: '80' } });
        // Slider drag (onValueChange) is a transient update: engine-only, isTransient=true.
        expect(mockSetTrackGain).toHaveBeenCalledWith('track-1', 0.8, true);
    });

    it('should call setTrackPan when knob value changes', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const knob = screen.getByTestId('rotary-knob');
        fireEvent.click(knob);
        // Knob mock fires onChange without isTransient, so the commit branch runs: isTransient=false.
        expect(mockSetTrackPan).toHaveBeenCalledWith('track-1', 11, false);
    });

    it('should render two surface cards', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const surfaceCards = screen.getAllByTestId('surface-card');
        expect(surfaceCards.length).toBe(2);
    });
});
