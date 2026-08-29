import { useState } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RetainedSectionRenderManualReview } from '../RetainedSectionRenderManualReview';

import type { selectRetainedSectionRenderManualReviews } from '../../../useCases/selectRetainedSectionRenderManualReviews';

const mocks = vi.hoisted(() => ({
    cacheAudioBuffer: vi.fn(),
    playCachedAudioBufferPreview: vi.fn(),
    releasePreviewAudioBuffer: vi.fn(),
    exportWav: vi.fn(),
    settle: vi.fn(),
    stop: vi.fn(),
    stopOther: vi.fn(),
    register: vi.fn(),
    release: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    playCachedAudioBufferPreview: mocks.playCachedAudioBufferPreview,
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/AudioRendering/useCases', () => ({
    exportExactAgentSectionRenderArtifactAsWav: mocks.exportWav,
}));
vi.mock('../../../useCases/settleRetainedSectionRenderManualReview', () => ({
    settleRetainedSectionRenderManualReview: mocks.settle,
}));

const previewCoordinator = {
    stopOther: mocks.stopOther,
    register: mocks.register,
    release: mocks.release,
};

const stereoVerseBuffer = { numberOfChannels: 2, id: 'stereo-verse' } as unknown as AudioBuffer;
const stereoChorusBuffer = { numberOfChannels: 2, id: 'stereo-chorus' } as unknown as AudioBuffer;
const verse = {
    jobId: 'job-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 48_000,
    tailSeconds: 1,
};
const chorus = {
    jobId: 'job-chorus',
    sectionId: 'section-chorus',
    sectionName: 'Chorus',
    startBeat: 16,
    endBeat: 32,
    sampleRate: 48_000,
    tailSeconds: 1,
};
const binding = {
    runId: 'run-review',
    batchId: 'batch-review',
    receiptIdentity: 'receipt-review',
    sourceRevision: 'revision-review',
    commands: [{ commandId: 'command-review', jobs: [verse, chorus] }],
};

type Review = ReturnType<typeof selectRetainedSectionRenderManualReviews>[number];

function artifactFor(
    job: typeof verse | typeof chorus,
    buffer: AudioBuffer,
    warnings: string[]
): Extract<Review['jobs'][number], { availability: 'available' }>['artifact'] {
    return {
        owner: 'agent-section-render',
        retention: 'session',
        ...job,
        sourceRevision: 'revision-review',
        renderedAt: 1,
        durationSeconds: 1,
        frameCount: job.sampleRate,
        channelCount: 2,
        byteSize: job.sampleRate * 8,
        warnings,
        buffer,
    };
}

function availableReview(): Review {
    return {
        binding,
        jobs: [
            {
                commandId: 'command-review',
                job: verse,
                availability: 'available' as const,
                artifact: artifactFor(verse, stereoVerseBuffer, []),
                warnings: [],
            },
            {
                commandId: 'command-review',
                job: chorus,
                availability: 'available' as const,
                artifact: artifactFor(chorus, stereoChorusBuffer, ['tail truncated']),
                warnings: ['tail truncated'],
            },
        ],
    };
}

const Harness = ({ review = availableReview() }: { review?: Review }) => {
    const [status, setStatus] = useState('');
    return (
        <>
            <RetainedSectionRenderManualReview
                review={review}
                onStatus={setStatus}
                previewCoordinator={previewCoordinator}
            />
            <output>{status}</output>
        </>
    );
};

describe('RetainedSectionRenderManualReview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cacheAudioBuffer.mockImplementation(({ buffer }) => `cached-${String(buffer.id)}`);
        mocks.playCachedAudioBufferPreview.mockReturnValue({ stop: mocks.stop });
        mocks.exportWav.mockResolvedValue(true);
    });

    it('offers per-job preview and export while keeping aggregate controls singular', async () => {
        render(<Harness />);

        expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: /^Export .* WAV$/ })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Accept retained render batch' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Discard retained render batch' })).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer: stereoVerseBuffer });
        expect(mocks.playCachedAudioBufferPreview).toHaveBeenCalledWith({
            bufferId: 'cached-stereo-verse',
            onEnded: expect.any(Function),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Stop Verse' }));
        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-verse');

        fireEvent.click(screen.getByRole('button', { name: 'Export Chorus WAV' }));
        await waitFor(() =>
            expect(mocks.exportWav).toHaveBeenCalledWith({ job: chorus, sourceRevision: 'revision-review' })
        );
        expect(screen.getByText('Exported the exact retained WAV.')).toBeInTheDocument();
    });

    it('releases the exact preview cache and restores Play when natural playback ends', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        const onEnded = mocks.playCachedAudioBufferPreview.mock.calls[0]?.[0].onEnded;
        if (!onEnded) {
            throw new Error('Expected the preview completion callback.');
        }

        act(() => onEnded());

        expect(mocks.stop).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('cached-stereo-verse');
        expect(screen.getByRole('button', { name: 'Play Verse' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('stops and releases Verse before starting the Chorus preview', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));

        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenNthCalledWith(1, 'cached-stereo-verse');
        expect(mocks.cacheAudioBuffer).toHaveBeenNthCalledWith(2, { buffer: stereoChorusBuffer });
        expect(mocks.playCachedAudioBufferPreview).toHaveBeenNthCalledWith(2, {
            bufferId: 'cached-stereo-chorus',
            onEnded: expect.any(Function),
        });
        expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.playCachedAudioBufferPreview.mock.invocationCallOrder[1]!
        );
        expect(mocks.releasePreviewAudioBuffer.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.playCachedAudioBufferPreview.mock.invocationCallOrder[1]!
        );
        expect(screen.getByRole('button', { name: 'Play Verse' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Stop Chorus' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('ignores Verse completion after Chorus owns playback without double-releasing either cache', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        const verseOnEnded = mocks.playCachedAudioBufferPreview.mock.calls[0]?.[0].onEnded;
        if (!verseOnEnded) {
            throw new Error('Expected the Verse completion callback.');
        }
        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        act(() => verseOnEnded());

        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.releasePreviewAudioBuffer.mock.calls).toEqual([['cached-stereo-verse']]);
        expect(screen.getByRole('button', { name: 'Stop Chorus' })).toHaveAttribute('aria-pressed', 'true');
    });

    it.each(['accepted', 'discarded'] as const)(
        'releases every preview cache before the batch is %s',
        (disposition) => {
            render(<Harness />);
            fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));

            fireEvent.click(
                screen.getByRole('button', {
                    name: disposition === 'accepted' ? 'Accept retained render batch' : 'Discard retained render batch',
                })
            );

            expect(mocks.stop).toHaveBeenCalledOnce();
            expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-verse');
            expect(mocks.settle).toHaveBeenCalledWith({ binding, disposition });
        }
    );

    it('releases preview cache on unmount', () => {
        const view = render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        view.unmount();

        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-chorus');
    });

    it('shows preview and export failures without retaining a failed preview cache', async () => {
        mocks.playCachedAudioBufferPreview.mockReturnValueOnce(null);
        mocks.exportWav.mockRejectedValueOnce(new Error('The exact WAV encoder failed.'));
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));
        expect(screen.getByText('Preview audio for Verse is unavailable.')).toBeInTheDocument();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-verse');

        fireEvent.click(screen.getByRole('button', { name: 'Export Chorus WAV' }));
        expect(await screen.findByText('The exact WAV encoder failed.')).toBeInTheDocument();
    });

    it('shows a cache failure without attempting playback or retaining a preview', () => {
        mocks.cacheAudioBuffer.mockImplementationOnce(() => {
            throw new Error('Preview cache failed.');
        });
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));

        expect(screen.getByText('Preview cache failed.')).toBeInTheDocument();
        expect(mocks.playCachedAudioBufferPreview).not.toHaveBeenCalled();
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
    });

    it('releases a newly cached buffer and shows the playback startup failure', () => {
        mocks.playCachedAudioBufferPreview.mockImplementationOnce(() => {
            throw new Error('Preview playback failed.');
        });
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));

        expect(screen.getByText('Preview playback failed.')).toBeInTheDocument();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-verse');
        expect(screen.getByRole('button', { name: 'Play Verse' })).toBeInTheDocument();
    });

    it('releases the preview cache and settles even when stopping playback throws', () => {
        mocks.stop.mockImplementationOnce(() => {
            throw new Error('Preview stop failed.');
        });
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Verse' }));

        fireEvent.click(screen.getByRole('button', { name: 'Accept retained render batch' }));

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-verse');
        expect(mocks.settle).toHaveBeenCalledWith({ binding, disposition: 'accepted' });
    });

    it('releases the preview cache on unmount even when stopping playback throws', () => {
        mocks.stop.mockImplementationOnce(() => {
            throw new Error('Preview stop failed.');
        });
        const view = render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Play Chorus' }));

        expect(() => view.unmount()).not.toThrow();
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledWith('cached-stereo-chorus');
    });

    it('shows one missing-evidence acknowledgement and visible operation errors', async () => {
        const available = availableReview();
        const review: Review = {
            ...available,
            jobs: [
                available.jobs[0]!,
                {
                    commandId: 'command-review',
                    job: chorus,
                    availability: 'unavailable',
                    reason: 'The exact chorus evidence expired.',
                    warnings: [],
                },
            ],
        };
        const UnavailableHarness = () => {
            const [status, setStatus] = useState('');
            return (
                <>
                    <RetainedSectionRenderManualReview
                        review={review}
                        onStatus={setStatus}
                        previewCoordinator={previewCoordinator}
                    />
                    <output>{status}</output>
                </>
            );
        };
        render(<UnavailableHarness />);

        expect(screen.getByText('The exact chorus evidence expired.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Accept retained render batch' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Acknowledge unavailable render evidence' })).toHaveLength(1);
        mocks.settle.mockImplementationOnce(() => {
            throw new Error('The durable review could not be persisted.');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Acknowledge unavailable render evidence' }));

        expect(mocks.settle).toHaveBeenCalledWith({ binding, disposition: 'missing-evidence' });
        expect(await screen.findByText('The durable review could not be persisted.')).toBeInTheDocument();
    });
});
