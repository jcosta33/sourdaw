import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WaveformEditor } from '../WaveformEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, variant, size, className, 'aria-pressed': ariaPressed, 'aria-label': ariaLabel }: { children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; className?: string; 'aria-pressed'?: boolean; 'aria-label'?: string }) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size} className={className} aria-pressed={ariaPressed} aria-label={ariaLabel}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange, min, max, step, className, 'aria-label': ariaLabel }: { value: number[]; onValueChange: (v: number[]) => void; min?: number; max?: number; step?: number; className?: string; 'aria-label'?: string }) => (
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

vi.mock('#/components/ui/disabled-feature-wrapper', () => ({
    DisabledFeatureWrapper: ({ children, disabled, reason }: { children: React.ReactNode; disabled: boolean; reason: string }) => (
        <div data-disabled={disabled} data-reason={reason}>{children}</div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) classes.push(key);
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/helpers/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: {
        getWaveformPeaks: vi.fn(() => []),
    },
}));

vi.mock('#/modules/Arrangement/useCases/trackViewActions/decodeAudioFile', () => ({
    decodeAudioFile: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));

vi.mock('#/modules/Arrangement/useCases/replaceClipAudioBuffer', () => ({
    replaceClipAudioBuffer: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/normalizeClip', () => ({
    normalizeClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipEditing/reverseClip', () => ({
    reverseClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/moveWarpMarker', () => ({
    moveWarpMarker: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/removeWarpMarker', () => ({
    removeWarpMarker: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/addWarpMarker', () => ({
    addWarpMarker: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/setStretchMode', () => ({
    setStretchMode: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/disableWarp', () => ({
    disableWarp: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/enableWarp', () => ({
    enableWarp: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/warp/helpers', () => ({
    getWarpState: vi.fn(() => ({ enabled: false, markers: [], stretchMode: 'complex', originalTempo: null })),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleAiDenoiseClip', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleStemSeparationPreview', () => ({
    handleStemSeparationPreview: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/audioToMidi', () => ({
    audioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/nativeAiBridge/isTauri', () => ({
    isTauri: vi.fn(() => false),
}));

describe('WaveformEditor', () => {
    const defaultProps = {
        clipId: 'clip-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform zoom')).toBeInTheDocument();
    });

    it('should render zoom slider', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform zoom')).toBeInTheDocument();
    });

    it('should render warp toggle button', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Toggle warp mode')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform editor')).toBeInTheDocument();
    });

    it('should have correct aria-label for canvas', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform editor')).toBeInTheDocument();
    });
});
