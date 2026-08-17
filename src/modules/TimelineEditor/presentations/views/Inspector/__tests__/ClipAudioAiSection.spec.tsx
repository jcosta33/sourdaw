import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        variant?: string;
        size?: string;
        className?: string;
        'aria-label'?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-variant={variant}
            data-size={size}
            className={className}
            aria-label={ariaLabel}
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
            onChange={(event) => onValueChange([Number(event.target.value)])}
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

vi.mock('#/modules/AiGeneration/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiGeneration/useCases')>();
    return {
        ...actual,
        handleAiDenoiseClip: vi.fn(),
    };
});

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();
    return {
        ...actual,
        polyphonicAudioToMidi: vi.fn(),
        insertPolyphonicMidiNotes: vi.fn(),
        detectDominantPitch: vi.fn(),
        summarizeFeatures: vi.fn(),
        audioToMidi: vi.fn(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(() => null),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiRuntime/useCases')>();
    return {
        ...actual,
        notifyAiChange: vi.fn(),
    };
});

describe('ClipAudioAiSection', () => {
    const defaultProps = {
        clip: {
            id: 'clip-1',
            type: 'audio' as const,
            name: 'Test Audio',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 8,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ff0000',
            locked: false,
            muted: false,
            audioBufferId: 'buffer-1',
        },
        trackId: 'track-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
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

    it('should render original and denoised controls when the denoised buffer is cached', () => {
        const denoised_audio_buffer = {
            duration: 1,
            length: 1,
            numberOfChannels: 1,
            sampleRate: 48_000,
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            getChannelData: vi.fn(() => new Float32Array(1)),
        } satisfies AudioBuffer;
        vi.mocked(getCachedAudioBuffer).mockReturnValue(denoised_audio_buffer);

        render(<ClipAudioAiSection {...defaultProps} />);

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1-denoised' });
        expect(screen.getByRole('button', { name: 'Listen to original audio' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Listen to denoised audio' })).toBeInTheDocument();
    });

    it('should not render original and denoised controls when the denoised buffer is missing', () => {
        render(<ClipAudioAiSection {...defaultProps} />);

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1-denoised' });
        expect(screen.queryByRole('button', { name: 'Listen to original audio' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Listen to denoised audio' })).not.toBeInTheDocument();
    });

    it('denoises the buffer the A/B controls read back: key round-trip on audioBufferId', () => {
        // The A/B `hasDenoised` check reads `${clip.audioBufferId}-denoised`
        // (asserted above), so Apply Denoise must key the write on the same
        // audioBufferId — not clip.id — or the result is orphaned in the cache.
        render(<ClipAudioAiSection {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /Apply Denoise/ }));

        expect(handleAiDenoiseClip).toHaveBeenCalledWith('buffer-1', 0.7);
    });

    it('does not advertise unavailable stem separation', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.queryByText('Separate Stems')).not.toBeInTheDocument();
    });

    it('should render MIDI (Basic) button', () => {
        render(<ClipAudioAiSection {...defaultProps} />);
        expect(screen.getByText('MIDI (Basic)')).toBeInTheDocument();
    });

    it('notifies success only when audioToMidi actually produced a clip', () => {
        vi.mocked(audioToMidi).mockReturnValue(true);

        render(<ClipAudioAiSection {...defaultProps} />);
        fireEvent.click(screen.getByText('MIDI (Basic)'));

        expect(audioToMidi).toHaveBeenCalledWith({ clipId: 'clip-1', trackId: 'track-1' });
        expect(notifyAiChange).toHaveBeenCalledWith('Audio converted to MIDI', [
            'New MIDI clip created from detected onsets',
        ]);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does not report success when audioToMidi silently finds nothing to convert', () => {
        // audioToMidi returns `false` (never throws) when the clip, buffer, onsets, or
        // MIDI-track resolution come up empty. Without gating on that result, this click
        // would always show "Audio converted to MIDI" regardless of outcome.
        vi.mocked(audioToMidi).mockReturnValue(false);

        render(<ClipAudioAiSection {...defaultProps} />);
        fireEvent.click(screen.getByText('MIDI (Basic)'));

        expect(notifyAiChange).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith('Audio to MIDI conversion failed', 'error');
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
