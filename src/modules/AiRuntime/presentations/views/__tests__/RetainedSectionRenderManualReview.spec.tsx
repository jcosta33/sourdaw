import { useState } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RetainedSectionRenderManualReview } from '../RetainedSectionRenderManualReview';

const mocks = vi.hoisted(() => ({
    cacheAudioBuffer: vi.fn(),
    playCachedAudioBufferPreview: vi.fn(),
    releasePreviewAudioBuffer: vi.fn(),
    exportWav: vi.fn(),
    settle: vi.fn(),
    stop: vi.fn(),
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

function availableReview() {
    return {
        binding,
        jobs: [
            {
                commandId: 'command-review',
                job: verse,
                availability: 'available' as const,
                artifact: { buffer: stereoVerseBuffer },
                warnings: [],
            },
            {
                commandId: 'command-review',
                job: chorus,
                availability: 'available' as const,
                artifact: { buffer: stereoChorusBuffer },
                warnings: ['tail truncated'],
            },
        ],
    };
}

const Harness = ({ review = availableReview() }: { review?: ReturnType<typeof availableReview> }) => {
    const [status, setStatus] = useState('');
    return (
        <>
            <RetainedSectionRenderManualReview review={review} onStatus={setStatus} />
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
        const review = availableReview();
        review.jobs[1] = {
            commandId: 'command-review',
            job: chorus,
            availability: 'unavailable',
            reason: 'The exact chorus evidence expired.',
            warnings: [],
        } as (typeof review.jobs)[number];
        const UnavailableHarness = () => {
            const [status, setStatus] = useState('');
            return (
                <>
                    <RetainedSectionRenderManualReview review={review} onStatus={setStatus} />
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
