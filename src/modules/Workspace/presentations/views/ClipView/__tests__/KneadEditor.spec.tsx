import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { analyzeClipPitch } from '#/modules/Knead/useCases';

import { useTracks } from '../../../hooks/useTracks';
import { KneadEditor } from '../KneadEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
    }) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size}>
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
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        className?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/daw/DawCompactCheckbox', () => ({
    DawCompactCheckbox: ({
        checked,
        onChange,
        id,
        className,
    }: {
        checked: boolean;
        onChange: (e: { target: { checked: boolean } }) => void;
        id?: string;
        className?: string;
    }) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange({ target: { checked: event.target.checked } })}
            id={id}
            className={className}
        />
    ),
}));

vi.mock('#/modules/Knead/stores', () => ({
    kneadStore: { value: { clips: {} } },
}));

vi.mock('#/modules/Knead/useCases', () => ({
    updateClipKneadState: vi.fn(),
    analyzeClipPitch: vi.fn(() => Promise.resolve({ status: 'no-buffer', reason: 'missing-clip-or-buffer' })),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue ?? {}),
}));

vi.mock('../../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('#/modules/Arrangement/useCases/device/addDevice', () => ({
    addDevice: vi.fn(),
}));

vi.mock('#/modules/Knead/useCases/dspAnalysis', () => ({
    ingestDspAnalysis: vi.fn(),
}));

describe('KneadEditor', () => {
    const defaultProps = {
        trackId: 'track-1',
        clipId: 'clip-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should render enable pitch editor button when no knead device', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Enable Pitch Editor')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should display disabled state icon', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should show description text when disabled', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText(/Enable Knead on this track/)).toBeInTheDocument();
    });

    // Regression (Observation 2): a clip that analyses successfully but yields
    // no blobs must NOT keep re-triggering analysis. Once a contour exists the
    // analysis has run, so the effect must treat empty blobs + a contour as a
    // terminal state, not as "never analysed".
    describe('empty-result analysis loop', () => {
        const kneadTrack = {
            id: 'track-1',
            devices: [{ type: 'Knead' }],
            clips: [{ id: 'clip-1' }],
        };

        beforeEach(() => {
            vi.mocked(useTracks).mockReturnValue({ tracks: [kneadTrack] } as never);
        });

        afterEach(() => {
            // Restore the default useStore stub for the outer suite's tests.
            vi.mocked(useStore).mockImplementation(((_store: unknown, fallback: unknown) => fallback ?? {}) as never);
            vi.mocked(useTracks).mockReturnValue({ tracks: [] } as never);
        });

        it('does not re-trigger analysis once a contour exists but blobs are empty', () => {
            vi.mocked(useStore).mockImplementation(((_store: unknown, fallback: unknown) => {
                // The kneadStore read: analysed-but-empty terminal state.
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: { 'clip-1': { clipId: 'clip-1', blobs: [] } },
                        contours: { 'clip-1': { points: [], sample_rate: 48000, hop_size: 256 } },
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                return fallback ?? {};
            }) as never);

            render(<KneadEditor {...defaultProps} />);

            expect(analyzeClipPitch).not.toHaveBeenCalled();
            expect(screen.getByText('No pitch detected in this clip.')).toBeInTheDocument();
        });

        it('triggers analysis when no contour has been computed yet', () => {
            vi.mocked(useStore).mockImplementation(((_store: unknown, fallback: unknown) => {
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: {},
                        contours: {},
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                return fallback ?? {};
            }) as never);

            render(<KneadEditor {...defaultProps} />);

            expect(analyzeClipPitch).toHaveBeenCalledWith('clip-1');
        });
    });
});
