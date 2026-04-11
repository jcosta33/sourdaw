import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipInspector } from '../ClipInspector';

vi.mock('#/components/daw/DawCompactInput', () => ({
    DawCompactInput: ({ value, onChange, onBlur, onKeyDown, size, className, 'aria-label': ariaLabel, autoFocus }: { value: string; onChange: (e: { target: { value: string } }) => void; onBlur?: () => void; onKeyDown?: (e: { key: string }) => void; size: string; className?: string; 'aria-label'?: string; autoFocus?: boolean }) => (
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
    DawCompactSelect: ({ value, onChange, id, size, align, className, children }: { value: string; onChange: (e: { target: { value: string } }) => void; id: string; size: string; align?: string; className?: string; children: React.ReactNode }) => (
        <select id={id} value={value} onChange={onChange} data-size={size} data-align={align} className={className}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact, className }: { title: string; compact?: boolean; className?: string }) => (
        <div className={className} data-compact={compact}>{title}</div>
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
    Slider: ({ value, onValueChange, min, max, step, 'aria-label': ariaLabel }: { value: number[]; onValueChange: (v: number[]) => void; min?: number; max?: number; step?: number; 'aria-label'?: string }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            aria-label={ariaLabel}
            onChange={(e) => onValueChange([Number(e.target.value)])}
        />
    ),
}));

vi.mock('#/components/ui/separator', () => ({
    Separator: () => <hr />,
}));

vi.mock('../../../components/Inspector/ControlHeader', () => ({
    ControlHeader: ({ label, value, valueClassName, className }: { label: string; value?: string; valueClassName?: string; className?: string }) => (
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
    InspectorDetailHeader: ({ title, onBack, backLabel }: { title: React.ReactNode; onBack: () => void; backLabel: string }) => (
        <div>
            <button type="button" onClick={onBack}>{backLabel}</button>
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

vi.mock('#/helpers/UI/colorPresets', () => ({
    CLIP_COLOR_PRESETS: ['#ff0000', '#00ff00', '#0000ff', ''],
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/trimClipStart', () => ({
    trimClipStart: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/trimClipEnd', () => ({
    trimClipEnd: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/setClipFade', () => ({
    setClipFade: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/setClipGain', () => ({
    setClipGain: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/setClipColor', () => ({
    setClipColor: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/renameClip', () => ({
    renameClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/setClipFollowAction', () => ({
    setClipFollowAction: vi.fn(),
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
            followAction: undefined as string | undefined,
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
});
