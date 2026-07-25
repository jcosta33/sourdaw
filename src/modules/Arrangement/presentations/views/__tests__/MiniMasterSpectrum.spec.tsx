import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { normalizeTrack } from '../../../models/Track';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../../hooks/useTracks';
import { MiniMasterSpectrum } from '../MiniMasterSpectrum';

// Capture the draw callback handed to animationScheduler.register so the test
// can drive a single spectrum redraw and assert the bar-painting behaviour.
const schedulerCallbacks = vi.hoisted(() => new Map<string, () => void>());

// Mock external dependencies
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: vi.fn(() => ({
        frequencyBinCount: 128,
        fftSize: 256,
        getByteFrequencyData: vi.fn((data: Uint8Array) => {
            // Populate alternating bins so the draw loop paints visible bars.
            data.fill(120);
        }),
    })),
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn((id: string, cb: () => void) => {
            schedulerCallbacks.set(id, cb);
        }),
        unregister: vi.fn((id: string) => {
            schedulerCallbacks.delete(id);
        }),
    },
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [{ id: 'master', kind: 'master' }],
        selectedTrackId: 'master',
    })),
}));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

// Build a capturing 2D context so a redraw's fillRect calls can be inspected.
const makeCapturingContext = () => {
    const gradient = { addColorStop: vi.fn() };
    return {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        set fillStyle(_v: unknown) {
            /* captured via fillRect args below */
        },
        get fillStyle() {
            return '';
        },
        setTransform: vi.fn(),
        createLinearGradient: vi.fn(() => gradient),
        get imageSmoothingEnabled() {
            return false;
        },
        set imageSmoothingEnabled(_v: boolean) {
            /* no-op */
        },
        canvas: null,
    } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> };
};

// Capture jsdom's original getContext so a context stub installed by one test
// can be restored before the next.
const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');

const installContext = (ctx: CanvasRenderingContext2D) => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        writable: true,
        value: (type: string) => (type === '2d' ? ctx : null),
    });
};

const restoreContext = () => {
    if (originalGetContext) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext);
    }
};

describe('MiniMasterSpectrum', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        schedulerCallbacks.clear();
        restoreContext();
        // Reset mock to default state
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'master',
        });
        // Re-establish the default master analyser (clearAllMocks wipes
        // mockReturnValue but not the factory default; reset explicitly for
        // determinism since later tests override it to throw / undefined).
        const { getMasterAnalyser } = await import('#/modules/AudioEngine/useCases');
        vi.mocked(getMasterAnalyser).mockReturnValue({
            frequencyBinCount: 128,
            fftSize: 256,
            getByteFrequencyData: vi.fn((data: Uint8Array) => {
                data.fill(120);
            }),
        } as unknown as AnalyserNode);
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render null when no master track', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [normalizeTrack({ id: 'audio1', name: 'Audio 1', kind: 'audio' })],
            selectedTrackId: null,
        });
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toBeNull();
    });

    it('should render canvas element', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should display "Master" label', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toBeInTheDocument();
    });

    it('should call selectTrack when clicked', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.click(spectrum);
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should call selectTrack when Enter key is pressed', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.keyDown(spectrum, { key: 'Enter' });
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should have pointer cursor', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toHaveClass('cursor-pointer');
    });

    it('should apply custom className', () => {
        const { container } = renderWithTooltip(<MiniMasterSpectrum className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have correct title attribute', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toHaveAttribute(
            'title',
            'Master Track (Click to inspect)'
        );
    });

    it('should call selectTrack when Space key is pressed', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.keyDown(spectrum, { key: ' ' });
        expect(selectTrack).toHaveBeenCalledWith('master');
    });

    it('should not call selectTrack for an unrelated key', () => {
        renderWithTooltip(<MiniMasterSpectrum />);
        const spectrum = screen.getByLabelText('Master Track Spectrum');
        fireEvent.keyDown(spectrum, { key: 'Escape' });
        expect(selectTrack).not.toHaveBeenCalled();
    });

    it('paints frequency bars on each scheduled redraw when the master is selected', () => {
        const ctx = makeCapturingContext();
        installContext(ctx);

        renderWithTooltip(<MiniMasterSpectrum />);

        // The effect registered exactly one draw callback for the selected master.
        expect(schedulerCallbacks.size).toBe(1);
        const draw = schedulerCallbacks.values().next().value as () => void;
        draw();

        // At least one bar is painted from the populated frequency data.
        expect(ctx.fillRect).toHaveBeenCalled();
        expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });

    it('clears the canvas and does not register a draw loop when the master is unselected', () => {
        const ctx = makeCapturingContext();
        installContext(ctx);
        vi.mocked(useTracks).mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'audio-1',
        });

        renderWithTooltip(<MiniMasterSpectrum />);

        // The unselected branch clears once and never registers a draw callback.
        expect(ctx.clearRect).toHaveBeenCalled();
        expect(schedulerCallbacks.size).toBe(0);
    });

    it('does not register a draw loop when getMasterAnalyser throws', async () => {
        installContext(makeCapturingContext());
        vi.mocked(useTracks).mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'master',
        });
        const { getMasterAnalyser } = await import('#/modules/AudioEngine/useCases');
        vi.mocked(getMasterAnalyser).mockImplementation(() => {
            throw new Error('engine not ready');
        });

        expect(() => renderWithTooltip(<MiniMasterSpectrum />)).not.toThrow();
        expect(schedulerCallbacks.size).toBe(0);
    });

    it('does not register a draw loop when no master analyser is available', async () => {
        installContext(makeCapturingContext());
        vi.mocked(useTracks).mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'master',
        });
        const { getMasterAnalyser } = await import('#/modules/AudioEngine/useCases');
        vi.mocked(getMasterAnalyser).mockReturnValue(undefined as unknown as AnalyserNode);

        renderWithTooltip(<MiniMasterSpectrum />);
        expect(schedulerCallbacks.size).toBe(0);
    });

    it('skips the redraw entirely while the document is hidden', () => {
        const ctx = makeCapturingContext();
        installContext(ctx);

        renderWithTooltip(<MiniMasterSpectrum />);
        const draw = schedulerCallbacks.values().next().value as () => void;

        const previous = document.hidden;
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        try {
            draw();
            // The hidden-tab guard returns before reading the analyser, so no
            // bars are painted this frame.
            expect(ctx.fillRect).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(document, 'hidden', { configurable: true, value: previous });
        }
    });

    it('renders the selected styling and label colour when the master is selected', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'master',
        });
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toHaveClass('bg-black/30');
        expect(screen.getByText('Master')).toHaveClass('text-foreground');
    });

    it('renders the unselected hover styling and muted label colour', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [normalizeTrack({ id: 'master', name: 'Master', kind: 'master' })],
            selectedTrackId: 'audio-1',
        });
        const { container } = renderWithTooltip(<MiniMasterSpectrum />);
        expect(container.firstChild).toHaveClass('hover:bg-white/[0.02]');
        expect(screen.getByText('Master')).toHaveClass('text-muted-foreground');
    });

    it('unregisters the draw loop on unmount', async () => {
        const { animationScheduler } = await import('#/utils/DOM/AnimationScheduler');
        installContext(makeCapturingContext());
        const { unmount } = renderWithTooltip(<MiniMasterSpectrum />);
        unmount();
        expect(vi.mocked(animationScheduler.unregister)).toHaveBeenCalled();
    });

    it('selects the master track among several tracks', () => {
        // Multiple tracks exercise the find predicate's false branch (non-master
        // tracks) before locating the master.
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                normalizeTrack({ id: 'audio-1', name: 'Audio 1', kind: 'audio' }),
                normalizeTrack({ id: 'master', name: 'Master', kind: 'master' }),
            ],
            selectedTrackId: 'master',
        });
        renderWithTooltip(<MiniMasterSpectrum />);
        expect(screen.getByLabelText('Master Track Spectrum')).toBeInTheDocument();
    });

    it('registers the draw loop when devicePixelRatio is 0 by falling back to 1', () => {
        const ctx = makeCapturingContext();
        installContext(ctx);
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });
        try {
            renderWithTooltip(<MiniMasterSpectrum />);
            // dpr 0 → `|| 1` fallback in both the unselected clearRect path and
            // the selected sizing path; the draw loop still registers.
            expect(schedulerCallbacks.size).toBe(1);
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', {
                configurable: true,
                value: original,
            });
        }
    });
});
