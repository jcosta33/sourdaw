import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipAudioAiSection } from '../ClipAudioAiSection';

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        startSlot,
        compact,
        className,
    }: {
        title: string;
        startSlot?: React.ReactNode;
        compact?: boolean;
        className?: string;
    }) => (
        <div className={className} data-compact={compact}>
            {startSlot}
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        disabled,
        variant,
        size,
        className,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        variant?: string;
        size?: string;
        className?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-variant={variant}
            data-size={size}
            className={className}
        >
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        min,
        max,
        step,
        className,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min: number;
        max: number;
        step: number;
        className?: string;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            aria-label={ariaLabel}
            onChange={(e) => onValueChange([Number(e.target.value)])}
        />
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TooltipTrigger: ({ children, asChild: _asChild }: { children: React.ReactNode; asChild?: boolean }) => (
        <>{children}</>
    ),
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

vi.mock('#/modules/AiGeneration/useCases/actions/handleAiDenoiseClip', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleStemSeparationPreview', () => ({
    handleStemSeparationPreview: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/polyphonicAudioToMidi', () => ({
    polyphonicAudioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/insertPolyphonicMidiNotes', () => ({
    insertPolyphonicMidiNotes: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/pitchDetection', () => ({
    detectDominantPitch: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/audioFeatures', () => ({
    summarizeFeatures: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/audioToMidi', () => ({
    audioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: {
        has: vi.fn(() => false),
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/notifyAiChange', () => ({
    notifyAiChange: vi.fn(),
}));

describe('ClipAudioAiSection', () => {
    const defaultProps = {
        clip: {
            id: 'clip-1',
            type: 'audio' as const,
            name: 'Test Audio',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buffer-1',
        },
        trackId: 'track-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('AI Actions')).toBeInTheDocument();
    });

    it('should display denoise section', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('Denoise')).toBeInTheDocument();
    });

    it('should render denoise strength slider', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByLabelText('Denoise strength')).toBeInTheDocument();
    });

    it('should render apply denoise button', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Apply Denoise/ })).toBeInTheDocument();
    });

    it('should render separate stems button', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('Separate Stems')).toBeInTheDocument();
    });

    it('should render MIDI (Basic) button', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('MIDI (Basic)')).toBeInTheDocument();
    });

    it('should render Polyphonic MIDI section', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('Polyphonic MIDI (AI)')).toBeInTheDocument();
    });

    it('should render Audio Analysis section', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('Audio Analysis')).toBeInTheDocument();
    });

    it('should render analyze clip button', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Analyze Clip/ })).toBeInTheDocument();
    });
});
