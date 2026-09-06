import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackLevelSection } from '../TrackLevelSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mockSetTrackGain = vi.fn();
const mockSetTrackPan = vi.fn();
const mockExecuteAppAction = vi.fn();
const mockReleaseTouchAutomation = vi.fn();

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        setTrackNotes: vi.fn(),
        setTrackColor: vi.fn(),
        setTrackPan: (...args: unknown[]) => mockSetTrackPan(...args),
        setTrackGain: (...args: unknown[]) => mockSetTrackGain(...args),
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    executeAppAction: (...args: unknown[]) => mockExecuteAppAction(...args),
    executeAppActionBatch: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    captureAutomationRecordingRollback: vi.fn(),
    clipAutomationMoveStateMatches: vi.fn(),
    duplicateClipAutomation: vi.fn(),
    duplicateClipAutomationBatch: vi.fn(),
    getAutomationLaneCeiling: vi.fn(),
    getAutomationLanes: vi.fn(),
    getClipAutomationMoveState: vi.fn(),
    recordAutomationValue: vi.fn(),
    releaseTouchAutomation: (...args: unknown[]) => mockReleaseTouchAutomation(...args),
    removeAutomationLane: vi.fn(),
    removeAutomationLanesForTrack: vi.fn(),
    removeMapping: vi.fn(),
    removeModulator: vi.fn(),
    restoreAutomationLanes: vi.fn(),
    restoreClipAutomationMoveState: vi.fn(),
    restoreTrackModulationReferences: vi.fn(),
    shiftClipAutomation: vi.fn(),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        onValueCommit,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (values: number[]) => void;
        onValueCommit?: (values: number[]) => void;
        'aria-label'?: string;
    }) => (
        <>
            <input
                type="range"
                data-testid="slider"
                data-label={ariaLabel}
                value={value[0]}
                onChange={(event) => onValueChange([Number(event.target.value)])}
            />
            <button type="button" data-testid="slider-commit" onClick={() => onValueCommit?.(value)}>
                Commit
            </button>
        </>
    ),
}));

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
        'aria-label': ariaLabel,
    }: {
        value: number;
        onChange: (v: number, isTransient?: boolean) => void;
        'aria-label'?: string;
    }) => (
        <button
            data-testid="rotary-knob"
            data-label={ariaLabel}
            data-value={value}
            onClick={() => onChange(value + 1, false)}
        >
            Knob
        </button>
    ),
}));

vi.mock('#/modules/ControlSurface/presentations/views', () => ({
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
        midiFx: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
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
        mockExecuteAppAction.mockResolvedValue(undefined);
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
        expect(mockSetTrackGain).toHaveBeenCalledWith('track-1', 0.8, true);
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('commits settled gain through executeAppAction so undo can restore it', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const slider = screen.getByTestId('slider');
        fireEvent.change(slider, { target: { value: '80' } });
        fireEvent.click(screen.getByTestId('slider-commit'));
        expect(mockExecuteAppAction).toHaveBeenCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.8, expectedGain: 0.75 },
        });
        expect(mockSetTrackGain).not.toHaveBeenCalledWith('track-1', 0.8, false);
    });

    it('commits settled pan through executeAppAction so undo can restore it', () => {
        render(<TrackLevelSection track={mockTrack} />);
        fireEvent.click(screen.getByTestId('rotary-knob'));
        expect(mockExecuteAppAction).toHaveBeenCalledWith({
            type: 'setTrackPan',
            payload: { trackId: 'track-1', pan: 11, expectedPan: 10 },
        });
        expect(mockSetTrackPan).not.toHaveBeenCalledWith('track-1', 11, false);
    });

    it('disarms Touch recording on pointerup even when the gesture never committed', () => {
        render(<TrackLevelSection track={{ ...mockTrack, automationMode: 'touch' }} />);
        fireEvent.pointerUp(screen.getByTestId('inspector-track-gain-release'));
        expect(mockReleaseTouchAutomation).toHaveBeenCalledWith('track-1', 'gain');
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
        fireEvent.pointerUp(screen.getByTestId('inspector-track-pan'));
        expect(mockReleaseTouchAutomation).toHaveBeenCalledWith('track-1', 'pan');
    });

    it('should render two surface cards', () => {
        render(<TrackLevelSection track={mockTrack} />);
        const surfaceCards = screen.getAllByTestId('surface-card');
        expect(surfaceCards.length).toBe(2);
    });
});
