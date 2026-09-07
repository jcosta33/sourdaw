import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiRenderClipPreview } from '../AiRenderClipPreview';

const mocks = vi.hoisted(() => ({
    cachePreviewAudioBuffer: vi.fn(),
    playCachedAudioBufferPreview: vi.fn(),
    releasePreviewAudioBuffer: vi.fn(),
    stop: vi.fn(),
    playback: {
        stop: vi.fn(),
    },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cachePreviewAudioBuffer: mocks.cachePreviewAudioBuffer,
    playCachedAudioBufferPreview: mocks.playCachedAudioBufferPreview,
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));

function render_preview(audio: Float32Array = new Float32Array([0.1, 0.2, 0.3])): ReturnType<typeof render> {
    return render(<AiRenderClipPreview audio={audio} sampleRate={48_000} label="A" name="Clip A" />);
}

function get_preview_row(): HTMLElement {
    const row = screen.getByText('Clip A').closest('div');
    if (!(row instanceof HTMLElement)) {
        throw new TypeError('preview row not found');
    }
    return row;
}

function create_data_transfer(dropEffect: DataTransfer['dropEffect'] = 'none') {
    return {
        setData: vi.fn(),
        effectAllowed: 'uninitialized',
        dropEffect,
    };
}

describe('AiRenderClipPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.playback = {
            stop: mocks.stop,
        };
        mocks.cachePreviewAudioBuffer.mockReturnValue('preview-buffer');
        mocks.playCachedAudioBufferPreview.mockReturnValue(mocks.playback);
    });

    it('should lazily cache and play through AudioEngine preview use cases', () => {
        const audio = new Float32Array([0.1, 0.2, 0.3]);
        render_preview(audio);

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));

        expect(mocks.cachePreviewAudioBuffer).toHaveBeenCalledWith({ audio, sampleRate: 48_000 });
        expect(mocks.playCachedAudioBufferPreview).toHaveBeenCalledWith({
            bufferId: 'preview-buffer',
            onEnded: expect.any(Function),
        });
        expect(screen.getByRole('button', { name: 'Stop A' })).toBeInTheDocument();
    });

    it('should stop the active source when preview is already playing', () => {
        render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));
        fireEvent.click(screen.getByRole('button', { name: 'Stop A' }));

        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Play A' })).toBeInTheDocument();
    });

    it('should keep playback stopped when the cached buffer is missing', () => {
        mocks.playCachedAudioBufferPreview.mockReturnValue(null);
        render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));

        expect(mocks.playCachedAudioBufferPreview).toHaveBeenCalledWith({
            bufferId: 'preview-buffer',
            onEnded: expect.any(Function),
        });
        expect(screen.getByRole('button', { name: 'Play A' })).toBeInTheDocument();
    });

    it('should release an unhanded preview buffer on unmount', () => {
        const view = render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));
        view.unmount();

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('preview-buffer');
    });

    it('should stop active preview playback on unmount', () => {
        const view = render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));
        view.unmount();

        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });

    it('should reset playback state when audio changes', () => {
        const view = render_preview(new Float32Array([0.1, 0.2, 0.3]));

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));
        view.rerender(
            <AiRenderClipPreview audio={new Float32Array([0.4, 0.5])} sampleRate={48_000} label="A" name="Clip A" />
        );

        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Play A' })).toBeInTheDocument();
    });

    it('should release a canceled drag preview on unmount', () => {
        const view = render_preview();
        const dataTransfer = create_data_transfer('none');

        fireEvent.dragStart(get_preview_row(), { dataTransfer });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer });
        view.unmount();

        expect(mocks.cachePreviewAudioBuffer).toHaveBeenCalledTimes(1);
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('preview-buffer');
    });

    it('should keep a successfully handed-off drag buffer cached', () => {
        const view = render_preview();
        const dataTransfer = create_data_transfer('copy');

        fireEvent.dragStart(get_preview_row(), { dataTransfer });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer });
        view.unmount();

        expect(dataTransfer.setData).toHaveBeenCalledWith(
            'application/x-sourdaw-ai-render',
            JSON.stringify({ name: 'Clip A', bufferId: 'preview-buffer', durationSeconds: 3 / 48_000 })
        );
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
    });

    // Regression (#3766): a canceled repeat drag must not revoke the ownership
    // the earlier successful drop established. The boolean mark this count
    // replaced forgot the first drop here, and the unmount release silenced the
    // placed clip.
    it('should keep a handed-off buffer cached when a later drag is canceled after a successful drop', () => {
        const view = render_preview();
        const accepted = create_data_transfer('copy');
        const canceled = create_data_transfer('none');

        fireEvent.dragStart(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragStart(get_preview_row(), { dataTransfer: canceled });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer: canceled });
        view.unmount();

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
    });

    it('should keep the handed-off buffer cached when audio is replaced after a successful drop', () => {
        const view = render_preview(new Float32Array([0.1, 0.2, 0.3]));
        const accepted = create_data_transfer('copy');

        fireEvent.dragStart(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer: accepted });
        view.rerender(
            <AiRenderClipPreview audio={new Float32Array([0.4, 0.5])} sampleRate={48_000} label="A" name="Clip A" />
        );

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalledWith('preview-buffer');
    });

    it('should keep the buffer cached while any of several successful drops still owns it', () => {
        const view = render_preview();
        const accepted = create_data_transfer('copy');

        fireEvent.dragStart(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragStart(get_preview_row(), { dataTransfer: accepted });
        fireEvent.dragEnd(get_preview_row(), { dataTransfer: accepted });
        view.unmount();

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
    });

    it('should clear play state when playback ends naturally', () => {
        render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));

        const { onEnded } = mocks.playCachedAudioBufferPreview.mock.calls[0]![0] as { onEnded: () => void };
        act(() => {
            onEnded();
        });

        expect(screen.getByRole('button', { name: 'Play A' })).toBeInTheDocument();
    });

    it('should ignore a stale onEnded callback from a superseded playback', () => {
        const firstPlayback = { stop: vi.fn() };
        const secondPlayback = { stop: vi.fn() };
        mocks.playCachedAudioBufferPreview.mockReturnValueOnce(firstPlayback).mockReturnValueOnce(secondPlayback);
        render_preview();

        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));
        const { onEnded: firstOnEnded } = mocks.playCachedAudioBufferPreview.mock.calls[0]![0] as {
            onEnded: () => void;
        };

        fireEvent.click(screen.getByRole('button', { name: 'Stop A' }));
        fireEvent.click(screen.getByRole('button', { name: 'Play A' }));

        act(() => {
            firstOnEnded();
        });

        expect(screen.getByRole('button', { name: 'Stop A' })).toBeInTheDocument();
    });
});
