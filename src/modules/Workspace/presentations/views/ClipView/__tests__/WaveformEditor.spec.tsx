import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getWarpState } from '#/modules/Arrangement/stores';
import {
    addManualWarpMarker,
    commitWarpMarkerBeatDrag,
    moveWarpMarker,
    normalizeClip,
} from '#/modules/Arrangement/useCases';

import { WaveformEditor } from '../WaveformEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
        className,
        'aria-pressed': ariaPressed,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
        className?: string;
        'aria-pressed'?: boolean;
        'aria-label'?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            data-variant={variant}
            data-size={size}
            className={className}
            aria-pressed={ariaPressed}
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
        min?: number;
        max?: number;
        step?: number;
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

vi.mock('#/components/ui/disabled-feature-wrapper', () => ({
    DisabledFeatureWrapper: ({
        children,
        disabled,
        reason,
    }: {
        children: React.ReactNode;
        disabled: boolean;
        reason: string;
    }) => (
        <div data-disabled={disabled} data-reason={reason}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: {
        getWaveformPeaks: vi.fn(() => []),
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return { tracks: [] };
        },
        getSnapshot: () => ({ tracks: [] }),
        subscribeReact: vi.fn(() => () => {}),
    },
    defaultTrackState: { tracks: [] },
    getWarpState: vi.fn(() => ({ enabled: false, markers: [], stretchMode: 'complex', originalTempo: null })),
    warpStates: new Map(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    replaceClipAudioBuffer: vi.fn(),
    normalizeClip: vi.fn(),
    reverseClip: vi.fn(),
    moveWarpMarker: vi.fn(),
    addManualWarpMarker: vi.fn(),
    commitWarpMarkerBeatDrag: vi.fn(),
    removeWarpMarker: vi.fn(),
    setStretchMode: vi.fn(),
    disableWarp: vi.fn(),
    enableWarp: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/trackViewActions/decodeAudioFile', () => ({
    decodeAudioFile: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleAiDenoiseClip', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases/actions/handleStemSeparationPreview', () => ({
    handleStemSeparationPreview: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases/audioToMidi', () => ({
    audioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/nativeAiBridge/isTauri', () => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('#/modules/Knead/stores', () => {
    const defaultKneadState = {
        activeClipId: null,
        clips: {},
        contours: {},
        isAnalyzing: false,
        analysisProgress: 0,
    };
    return {
        kneadStore: {
            get value() {
                return defaultKneadState;
            },
            getSnapshot: () => defaultKneadState,
            subscribe: vi.fn(() => () => {}),
            subscribeReact: vi.fn(() => () => {}),
            set: vi.fn(),
        },
        defaultKneadState,
    };
});

vi.mock('#/infra/store/useStore', () => ({
    useStore: <T,>(_store: unknown, defaultValue: T): T => defaultValue,
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

    it('should add manual warp marker through the Arrangement use case on double click', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.doubleClick(screen.getByLabelText('Waveform editor'), { clientX: 80 });

        expect(vi.mocked(addManualWarpMarker)).toHaveBeenCalledWith({ clipId: 'clip-1', beat: 2 });
    });

    it('should run a waveform context menu action and close the menu', () => {
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        const normalizeMenuItem = screen.getByRole('menuitem', { name: 'Normalize' });
        expect(normalizeMenuItem.tagName).toBe('BUTTON');

        fireEvent.click(normalizeMenuItem);

        expect(vi.mocked(normalizeClip)).toHaveBeenCalledWith('clip-1');
        expect(screen.queryByRole('menuitem', { name: 'Normalize' })).not.toBeInTheDocument();
    });

    it('should commit marker drag undo on pointer up', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0.5, warpedBeat: 1 }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        const canvas = screen.getByLabelText('Waveform editor');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
        fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });

        expect(vi.mocked(moveWarpMarker)).toHaveBeenCalledWith('clip-1', 'm1', 2.1);
        expect(vi.mocked(commitWarpMarkerBeatDrag)).toHaveBeenCalledWith({
            clipId: 'clip-1',
            markerId: 'm1',
            beforeOriginalBeat: 0.5,
            beforeWarpedBeat: 1,
        });
    });

    it('should commit marker drag undo on pointer cancel', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0.5, warpedBeat: 1 }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        const canvas = screen.getByLabelText('Waveform editor');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
        fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
        fireEvent.pointerCancel(canvas, { pointerId: 7 });

        expect(vi.mocked(commitWarpMarkerBeatDrag)).toHaveBeenCalledWith({
            clipId: 'clip-1',
            markerId: 'm1',
            beforeOriginalBeat: 0.5,
            beforeWarpedBeat: 1,
        });
    });
});
