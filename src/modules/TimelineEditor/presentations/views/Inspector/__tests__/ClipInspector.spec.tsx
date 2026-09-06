import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { ClipInspector } from '../ClipInspector';

vi.mock('#/components/daw/DawCompactInput', () => ({
    DawCompactInput: ({
        value,
        onChange,
        onBlur,
        onKeyDown,
        size,
        className,
        'aria-label': ariaLabel,
        autoFocus,
    }: {
        value: string;
        onChange: (e: { target: { value: string } }) => void;
        onBlur?: () => void;
        onKeyDown?: (e: { key: string }) => void;
        size: string;
        className?: string;
        'aria-label'?: string;
        autoFocus?: boolean;
    }) => (
        <input
            type="text"
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className={className}
            aria-label={ariaLabel}
            autoFocus={autoFocus}
            data-size={size}
        />
    ),
}));

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        id,
        size,
        align,
        className,
        children,
    }: {
        value: string;
        onChange: (e: { target: { value: string } }) => void;
        id: string;
        size: string;
        align?: string;
        className?: string;
        children: React.ReactNode;
    }) => (
        <select id={id} value={value} onChange={onChange} data-size={size} data-align={align} className={className}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact, className }: { title: string; compact?: boolean; className?: string }) => (
        <div className={className} data-compact={compact}>
            {title}
        </div>
    ),
}));

vi.mock('#/components/daw/DawReadoutRow', () => ({
    DawReadoutRow: ({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) => (
        <div>
            <span>{label}</span>
            <span className={valueClassName}>{value}</span>
        </div>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        onValueCommit,
        min,
        max,
        step,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        onValueCommit?: (v: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            aria-label={ariaLabel}
            onChange={(event) => onValueChange([Number(event.target.value)])}
            onBlur={(event) => onValueCommit?.([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/ui/separator', () => ({
    Separator: () => <hr />,
}));

vi.mock('../../../components/Inspector/ControlHeader', () => ({
    ControlHeader: ({
        label,
        value,
        valueClassName,
        className,
    }: {
        label: string;
        value?: string;
        valueClassName?: string;
        className?: string;
    }) => (
        <div className={className}>
            <span>{label}</span>
            {value && <span className={valueClassName}>{value}</span>}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/InsetPanel', () => ({
    InsetPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('../../../components/Inspector/InspectorDetailHeader', () => ({
    InspectorDetailHeader: ({
        title,
        onBack,
        backLabel,
    }: {
        title: React.ReactNode;
        onBack: () => void;
        backLabel: string;
    }) => (
        <div>
            <button type="button" onClick={onBack}>
                {backLabel}
            </button>
            <div>{title}</div>
        </div>
    ),
}));

vi.mock('../ClipGainEnvelopeSection', () => ({
    ClipGainEnvelopeSection: () => <div data-testid="gain-envelope-section">Gain Envelope Section</div>,
}));

vi.mock('../ClipAudioAiSection', () => ({
    ClipAudioAiSection: () => <div data-testid="audio-ai-section">Audio AI Section</div>,
}));

vi.mock('../ClipMidiAiSection', () => ({
    ClipMidiAiSection: () => <div data-testid="midi-ai-section">MIDI AI Section</div>,
}));

vi.mock('#/utils/UI/colorPresets', () => ({
    CLIP_COLOR_PRESETS: ['#ff0000', '#00ff00', '#0000ff', ''],
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        trimClipStart: vi.fn(),
        trimClipEnd: vi.fn(),
        setClipFade: vi.fn(),
        setClipGain: vi.fn(),
        setClipColor: vi.fn(),
        renameClip: vi.fn(),
        setClipFollowAction: vi.fn(),
    };
});

const commandMocks = vi.hoisted(() => ({
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: commandMocks.executeUserAppAction,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

describe('ClipInspector', () => {
    const defaultProps = {
        clip: {
            id: 'clip-1',
            type: 'audio' as const,
            name: 'Test Audio',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 8,
            fadeInBeats: 0.5,
            fadeOutBeats: 0.5,
            gain: 1,
            color: '#ff0000',
            followAction: undefined,
            locked: false,
            muted: false,
            audioBufferId: 'buffer-1',
        },
        trackId: 'track-1',
        onBack: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Test Audio')).toBeInTheDocument();
    });

    it('should display clip name', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Test Audio')).toBeInTheDocument();
    });

    it('should call onBack when back button is clicked', () => {
        render(<ClipInspector {...defaultProps} />);
        fireEvent.click(screen.getByText('Back to track'));
        expect(defaultProps.onBack).toHaveBeenCalled();
    });

    it('should render Position section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Position')).toBeInTheDocument();
    });

    it('should render Trim section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Trim')).toBeInTheDocument();
    });

    it('should render Fades section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Fades')).toBeInTheDocument();
    });

    it('should render Gain section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should render Color section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Color')).toBeInTheDocument();
    });

    it('should render Properties section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByText('Properties')).toBeInTheDocument();
    });

    it('should render gain envelope section', () => {
        render(<ClipInspector {...defaultProps} />);
        expect(screen.getByTestId('gain-envelope-section')).toBeInTheDocument();
    });

    it('should render audio AI section for audio clips', () => {
        render(<ClipInspector {...defaultProps} clip={{ ...defaultProps.clip, type: 'audio' }} />);
        expect(screen.getByTestId('audio-ai-section')).toBeInTheDocument();
    });

    it('should render MIDI AI section for MIDI clips', () => {
        render(<ClipInspector {...defaultProps} clip={{ ...defaultProps.clip, type: 'midi' }} />);
        expect(screen.getByTestId('midi-ai-section')).toBeInTheDocument();
    });

    it('reads the clip gain back in decibels', () => {
        render(<ClipInspector {...defaultProps} clip={{ ...defaultProps.clip, gain: 1.4125 }} />);
        expect(screen.getByText('3.0 dB')).toBeInTheDocument();
    });

    it('reads a silent clip gain as -∞ dB', () => {
        render(<ClipInspector {...defaultProps} clip={{ ...defaultProps.clip, gain: 0 }} />);
        expect(screen.getByText('-∞ dB')).toBeInTheDocument();
    });

    it('commits one undoable setClipGain action per slider gesture, anchored on the pre-gesture gain', () => {
        render(<ClipInspector {...defaultProps} />);
        const slider = screen.getByLabelText('Clip gain');

        fireEvent.change(slider, { target: { value: '-12' } });
        fireEvent.change(slider, { target: { value: '-6' } });
        // Mid-gesture ticks never reach the command layer.
        expect(commandMocks.executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.blur(slider, { target: { value: '-6' } });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setClipGain',
            payload: { clipId: 'clip-1', gain: dbToGain(-6), expectedGain: 1 },
        });
    });

    it('dispatches nothing when the gesture ends where it started', () => {
        render(<ClipInspector {...defaultProps} />);
        const slider = screen.getByLabelText('Clip gain');

        fireEvent.change(slider, { target: { value: '0' } });
        fireEvent.blur(slider, { target: { value: '0' } });

        expect(commandMocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it('treats the bottom of the slider travel as silence', () => {
        render(<ClipInspector {...defaultProps} />);
        const slider = screen.getByLabelText('Clip gain');

        fireEvent.change(slider, { target: { value: '-60' } });
        fireEvent.blur(slider, { target: { value: '-60' } });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setClipGain',
            payload: { clipId: 'clip-1', gain: 0, expectedGain: 1 },
        });
    });

    it('commits an exact dB entry through the same undoable action', () => {
        render(<ClipInspector {...defaultProps} />);
        const input = screen.getByLabelText('Clip gain value');

        fireEvent.change(input, { target: { value: '-3' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setClipGain',
            payload: { clipId: 'clip-1', gain: dbToGain(-3), expectedGain: 1 },
        });
    });

    it('accepts -inf as silence in the exact entry', () => {
        render(<ClipInspector {...defaultProps} />);
        const input = screen.getByLabelText('Clip gain value');

        fireEvent.change(input, { target: { value: '-inf' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setClipGain',
            payload: { clipId: 'clip-1', gain: 0, expectedGain: 1 },
        });
    });

    it('reverts an unparseable entry without dispatching', () => {
        render(<ClipInspector {...defaultProps} />);
        const input = screen.getByLabelText('Clip gain value');

        fireEvent.change(input, { target: { value: 'loud' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(commandMocks.executeUserAppAction).not.toHaveBeenCalled();
    });
});
