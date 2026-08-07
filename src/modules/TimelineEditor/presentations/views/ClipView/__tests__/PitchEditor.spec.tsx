import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { type KneadStoreState, type PitchContour } from '#/modules/Knead/stores';
import { analyzeClipPitch } from '#/modules/Knead/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { PitchEditor } from '../PitchEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('#/modules/Knead/stores', () => ({
    kneadStore: {},
    defaultKneadState: { activeClipId: null, clips: {}, contours: {}, isAnalyzing: false, analysisProgress: 0 },
}));

vi.mock('#/modules/Knead/useCases', () => ({
    analyzeClipPitch: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

const IDLE_STATE: KneadStoreState = {
    activeClipId: null,
    clips: {},
    contours: {},
    isAnalyzing: false,
    analysisProgress: 0,
};

const makeContour = (lastTimeMs: number): PitchContour => ({
    points: [
        { time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true },
        { time_ms: lastTimeMs, frequency_hz: 220, confidence: 0.9, voiced: true },
    ],
    sample_rate: 48000,
    hop_size: 256,
});

describe('PitchEditor', () => {
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        emit = vi.fn().mockResolvedValue(undefined);
        injectDependencies(notifyUser, { eventBus: { emit } });
        vi.mocked(useStore).mockReturnValue(IDLE_STATE);
        vi.mocked(executeAppAction).mockResolvedValue(undefined);
    });

    it('should show Analyze Pitch when idle with no contour', () => {
        render(<PitchEditor clipId="clip-1" />);
        expect(screen.getByText('Analyze Pitch')).toBeInTheDocument();
        expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
    });

    it('should show the analysis progress and hide Analyze Pitch while analyzing', () => {
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, isAnalyzing: true, analysisProgress: 0.42 });
        render(<PitchEditor clipId="clip-1" />);
        expect(screen.getByText('42%')).toBeInTheDocument();
        expect(screen.queryByText('Analyze Pitch')).not.toBeInTheDocument();
    });

    it('should show Bounce & Commit once a contour exists', () => {
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': makeContour(300) } });
        render(<PitchEditor clipId="clip-1" />);
        expect(screen.getByText('Bounce & Commit')).toBeInTheDocument();
        expect(screen.queryByText('Analyze Pitch')).not.toBeInTheDocument();
    });

    it('should notify the user when analysis reports no audio buffer', async () => {
        vi.mocked(analyzeClipPitch).mockResolvedValue({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        render(<PitchEditor clipId="clip-9" />);
        fireEvent.click(screen.getByText('Analyze Pitch'));

        expect(analyzeClipPitch).toHaveBeenCalledWith('clip-9');
        await waitFor(() =>
            expect(emit).toHaveBeenCalledWith('ui.notify', {
                message:
                    'Pitch analysis skipped: this clip has no audio buffer. Record or import audio into the track first.',
                level: 'info',
            })
        );
    });

    it('should not notify the user when analysis succeeds', async () => {
        vi.mocked(analyzeClipPitch).mockResolvedValue({ status: 'analyzed', contour: makeContour(100) });
        render(<PitchEditor clipId="clip-1" />);
        fireEvent.click(screen.getByText('Analyze Pitch'));

        await vi.mocked(analyzeClipPitch).mock.results[0]!.value;
        expect(emit).not.toHaveBeenCalled();
    });

    it('should log and notify a failure when analysis rejects', async () => {
        const failure = new Error('native backend offline');
        vi.mocked(analyzeClipPitch).mockRejectedValue(failure);
        vi.spyOn(logger, 'error').mockImplementation(() => {});
        render(<PitchEditor clipId="clip-1" />);
        fireEvent.click(screen.getByText('Analyze Pitch'));

        await waitFor(() => expect(logger.error).toHaveBeenCalledWith(failure));
        expect(emit).toHaveBeenCalledWith('ui.notify', {
            message: 'Pitch analysis failed. See logs for details.',
            level: 'error',
        });
    });

    it('should not capture pointer events when no contour exists so the waveform beneath stays interactive', () => {
        render(<PitchEditor clipId="clip-1" />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas).toHaveClass('pointer-events-none');
        expect(canvas).not.toHaveClass('pointer-events-auto');
    });

    it('should not capture pointer events while analyzing so the waveform beneath stays interactive', () => {
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, isAnalyzing: true, analysisProgress: 0.5 });
        render(<PitchEditor clipId="clip-1" />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas).toHaveClass('pointer-events-none');
    });

    it('should treat a contour with no points as no contour: no capture, Analyze Pitch offered, commit hidden', () => {
        const emptyContour: PitchContour = { points: [], sample_rate: 48000, hop_size: 256 };
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': emptyContour } });
        render(<PitchEditor clipId="clip-1" />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas).toHaveClass('pointer-events-none');
        expect(canvas).not.toHaveClass('pointer-events-auto');
        expect(screen.getByText('Analyze Pitch')).toBeInTheDocument();
        expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
    });

    it('should capture pointer events once a contour exists so pitch editing works', () => {
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': makeContour(300) } });
        render(<PitchEditor clipId="clip-1" />);
        const canvas = document.querySelector('canvas')!;
        expect(canvas).toHaveClass('pointer-events-auto');
        expect(canvas).not.toHaveClass('pointer-events-none');
    });

    it('should not commit when a contour exists but no segments were generated', () => {
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': makeContour(0) } });
        render(<PitchEditor clipId="clip-1" />);
        fireEvent.click(screen.getByText('Bounce & Commit'));
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('should commit the dragged pitch shift for the touched segment', () => {
        const contour = makeContour(300);
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': contour } });
        render(<PitchEditor clipId="clip-1" />);

        const canvas = document.querySelector('canvas')!;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            width: 300,
            top: 0,
            height: 100,
            right: 300,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: (): unknown => ({}),
        });

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 70 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150, clientY: 70 });

        fireEvent.click(screen.getByText('Bounce & Commit'));

        const segments = [
            { start_time_ms: 0, end_time_ms: 100, shift_semitones: 0 },
            { start_time_ms: 100, end_time_ms: 200, shift_semitones: 3 },
            { start_time_ms: 200, end_time_ms: 300, shift_semitones: 0 },
        ];
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'commitPitchEdit',
            payload: { clipId: 'clip-1', segments, contour },
        });
    });

    it('should reset dragged shifts when a cleared contour is re-analyzed so a recommit does not double-bake', () => {
        const contourA = makeContour(300);
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': contourA } });
        const { rerender } = render(<PitchEditor clipId="clip-1" />);

        const canvas = document.querySelector('canvas')!;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            width: 300,
            top: 0,
            height: 100,
            right: 300,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: (): unknown => ({}),
        });

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 70 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150, clientY: 70 });
        fireEvent.click(screen.getByText('Bounce & Commit'));

        expect(executeAppAction).toHaveBeenNthCalledWith(1, {
            type: 'commitPitchEdit',
            payload: {
                clipId: 'clip-1',
                segments: [
                    { start_time_ms: 0, end_time_ms: 100, shift_semitones: 0 },
                    { start_time_ms: 100, end_time_ms: 200, shift_semitones: 3 },
                    { start_time_ms: 200, end_time_ms: 300, shift_semitones: 0 },
                ],
                contour: contourA,
            },
        });

        // The commit clears the stored contour; re-analysis stores a fresh one.
        vi.mocked(useStore).mockReturnValue(IDLE_STATE);
        rerender(<PitchEditor clipId="clip-1" />);
        const contourB = makeContour(300);
        vi.mocked(useStore).mockReturnValue({ ...IDLE_STATE, contours: { 'clip-1': contourB } });
        rerender(<PitchEditor clipId="clip-1" />);

        fireEvent.click(screen.getByText('Bounce & Commit'));

        expect(executeAppAction).toHaveBeenNthCalledWith(2, {
            type: 'commitPitchEdit',
            payload: {
                clipId: 'clip-1',
                segments: [
                    { start_time_ms: 0, end_time_ms: 100, shift_semitones: 0 },
                    { start_time_ms: 100, end_time_ms: 200, shift_semitones: 0 },
                    { start_time_ms: 200, end_time_ms: 300, shift_semitones: 0 },
                ],
                contour: contourB,
            },
        });
    });

    // audit M-249 — the audio editor is reused across clip switches, so the
    // sibling waveform strip used to keep the previous clip's warp state. The
    // dragged pitch shifts here are keyed on contour identity rather than on
    // `clipId`; this pins that they really do fall away with the old clip.
    it('should drop the previous clip dragged shifts when the edited clip changes', () => {
        const contourForClipOne = makeContour(300);
        const contourForClipTwo = makeContour(200);
        vi.mocked(useStore).mockReturnValue({
            ...IDLE_STATE,
            contours: { 'clip-1': contourForClipOne, 'clip-2': contourForClipTwo },
        });
        const { rerender } = render(<PitchEditor clipId="clip-1" />);

        const canvas = document.querySelector('canvas')!;
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            width: 300,
            top: 0,
            height: 100,
            right: 300,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: (): unknown => ({}),
        });

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 70 });
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 150, clientY: 70 });

        rerender(<PitchEditor clipId="clip-2" />);
        fireEvent.click(screen.getByText('Bounce & Commit'));

        // clip-2 is 200ms long and untouched: two flat segments, not clip-1's
        // three segments carrying the +3 semitone drag.
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'commitPitchEdit',
            payload: {
                clipId: 'clip-2',
                segments: [
                    { start_time_ms: 0, end_time_ms: 100, shift_semitones: 0 },
                    { start_time_ms: 100, end_time_ms: 200, shift_semitones: 0 },
                ],
                contour: contourForClipTwo,
            },
        });
    });
});
