import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Download, Play, Square } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import {
    cacheAudioBuffer,
    playCachedAudioBufferPreview,
    releasePreviewAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import {
    exportExactAgentSectionRenderArtifactAsWav,
    getExactAgentSectionRenderArtifact,
} from '#/modules/AudioRendering/useCases';

import { settleRetainedSectionRenderManualReview } from '../../useCases/settleRetainedSectionRenderManualReview';

import type { selectRetainedSectionRenderManualReviews } from '../../useCases/selectRetainedSectionRenderManualReviews';

type Review = ReturnType<typeof selectRetainedSectionRenderManualReviews>[number];
type AvailableJob = Extract<Review['jobs'][number], { availability: 'available' }>;
type PreviewPlayback = NonNullable<ReturnType<typeof playCachedAudioBufferPreview>>;
type ActivePreview = { bufferId: string; playback: PreviewPlayback };

export type RetainedSectionRenderPreviewCoordinator = {
    stopOther: (ownerId: string) => void;
    register: (ownerId: string, stop: () => void) => void;
    release: (ownerId: string) => void;
};

type RetainedSectionRenderManualReviewProps = {
    review: Review;
    onStatus: (message: string) => void;
    previewCoordinator: RetainedSectionRenderPreviewCoordinator;
};

function getJobKey(job: Review['jobs'][number]): string {
    return `${job.commandId}:${job.job.jobId}`;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function stopAndReleasePreview(preview: ActivePreview): unknown {
    let cleanupError: unknown;
    try {
        preview.playback.stop();
    } catch (error) {
        cleanupError = error;
    }
    try {
        releasePreviewAudioBuffer(preview.bufferId);
    } catch (error) {
        cleanupError ??= error;
    }
    return cleanupError;
}

export const RetainedSectionRenderManualReview = ({
    review,
    onStatus,
    previewCoordinator,
}: RetainedSectionRenderManualReviewProps): ReactElement => {
    const previewOwnerId = `${review.binding.runId}:${review.binding.batchId}`;
    const previewsRef = useRef(new Map<string, ActivePreview>());
    const [playingJobKey, setPlayingJobKey] = useState<string | null>(null);
    const [workingJobKey, setWorkingJobKey] = useState<string | null>(null);
    const [isSettling, setIsSettling] = useState(false);

    const releasePreview = (jobKey: string): void => {
        const preview = previewsRef.current.get(jobKey);
        if (!preview) {
            return;
        }
        previewsRef.current.delete(jobKey);
        const cleanupError = stopAndReleasePreview(preview);
        if (playingJobKey === jobKey) {
            setPlayingJobKey(null);
        }
        previewCoordinator.release(previewOwnerId);
        if (cleanupError) {
            onStatus(getErrorMessage(cleanupError));
        }
    };

    const releaseAllPreviews = (reportErrors = true): void => {
        let cleanupError: unknown;
        for (const [jobKey, preview] of previewsRef.current) {
            previewsRef.current.delete(jobKey);
            const previewCleanupError = stopAndReleasePreview(preview);
            cleanupError ??= previewCleanupError;
        }
        setPlayingJobKey(null);
        previewCoordinator.release(previewOwnerId);
        if (reportErrors && cleanupError) {
            onStatus(getErrorMessage(cleanupError));
        }
    };

    useEffect(
        () => () => {
            for (const preview of previewsRef.current.values()) {
                stopAndReleasePreview(preview);
            }
            previewsRef.current.clear();
            previewCoordinator.release(previewOwnerId);
        },
        [previewCoordinator, previewOwnerId]
    );

    useEffect(() => {
        const availableJobKeys = new Set(
            review.jobs.filter(({ availability }) => availability === 'available').map(getJobKey)
        );
        for (const [jobKey, preview] of previewsRef.current) {
            if (availableJobKeys.has(jobKey)) {
                continue;
            }
            previewsRef.current.delete(jobKey);
            const cleanupError = stopAndReleasePreview(preview);
            setPlayingJobKey((current) => (current === jobKey ? null : current));
            previewCoordinator.release(previewOwnerId);
            if (cleanupError) {
                onStatus(getErrorMessage(cleanupError));
            }
        }
    }, [onStatus, previewCoordinator, previewOwnerId, review.jobs]);

    const play = (job: AvailableJob): void => {
        const jobKey = getJobKey(job);
        if (playingJobKey === jobKey) {
            releasePreview(jobKey);
            return;
        }
        const artifact = getExactAgentSectionRenderArtifact({
            job: job.job,
            sourceRevision: review.binding.sourceRevision,
        });
        if (!artifact) {
            onStatus(`Preview audio for ${job.job.sectionName} is unavailable.`);
            return;
        }
        releaseAllPreviews();
        previewCoordinator.stopOther(previewOwnerId);
        let bufferId: string;
        try {
            bufferId = cacheAudioBuffer({ buffer: artifact.buffer });
        } catch (error) {
            onStatus(getErrorMessage(error));
            return;
        }
        let playback: PreviewPlayback | null = null;
        try {
            playback = playCachedAudioBufferPreview({
                bufferId,
                onEnded: () => {
                    if (previewsRef.current.get(jobKey)?.playback !== playback) {
                        return;
                    }
                    previewsRef.current.delete(jobKey);
                    try {
                        releasePreviewAudioBuffer(bufferId);
                    } catch (error) {
                        onStatus(getErrorMessage(error));
                    }
                    setPlayingJobKey(null);
                    previewCoordinator.release(previewOwnerId);
                },
            });
        } catch (error) {
            try {
                releasePreviewAudioBuffer(bufferId);
            } catch {
                // Preserve the playback startup failure while still attempting cache cleanup.
            }
            onStatus(getErrorMessage(error));
            return;
        }
        if (!playback) {
            try {
                releasePreviewAudioBuffer(bufferId);
            } catch {
                // The unavailable preview is the actionable status; cache release was still attempted.
            }
            onStatus(`Preview audio for ${job.job.sectionName} is unavailable.`);
            return;
        }
        previewsRef.current.set(jobKey, { bufferId, playback });
        previewCoordinator.register(previewOwnerId, releaseAllPreviews);
        setPlayingJobKey(jobKey);
    };

    const exportWav = async (job: AvailableJob): Promise<void> => {
        const jobKey = getJobKey(job);
        try {
            setWorkingJobKey(jobKey);
            const exported = await exportExactAgentSectionRenderArtifactAsWav({
                job: job.job,
                sourceRevision: review.binding.sourceRevision,
            });
            onStatus(exported ? 'Exported the exact retained WAV.' : 'WAV export was cancelled.');
        } catch (error) {
            onStatus(error instanceof Error ? error.message : String(error));
        } finally {
            setWorkingJobKey(null);
        }
    };

    const settle = (disposition: 'accepted' | 'discarded' | 'missing-evidence'): void => {
        try {
            setIsSettling(true);
            releaseAllPreviews();
            settleRetainedSectionRenderManualReview({ binding: review.binding, disposition });
            onStatus(
                disposition === 'missing-evidence'
                    ? 'Acknowledged unavailable render evidence.'
                    : `Render review ${disposition}.`
            );
        } catch (error) {
            onStatus(error instanceof Error ? error.message : String(error));
        } finally {
            setIsSettling(false);
        }
    };

    const hasUnavailableEvidence = review.jobs.some(({ availability }) => availability === 'unavailable');
    return (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs">
            <p className="font-medium text-foreground">Retained section render requires review</p>
            <p className="mt-1 text-muted-foreground">
                Receipt {review.binding.receiptIdentity}; {review.binding.commands.length} render command(s).
            </p>
            <Stack as="ul" gap={2} className="mt-2" aria-label="Receipt-bound retained render jobs">
                {review.jobs.map((job) => {
                    const jobKey = getJobKey(job);
                    return (
                        <li key={jobKey} className="rounded border border-border/60 px-2 py-1.5">
                            <p className="text-foreground">
                                {job.job.sectionName}: beats {job.job.startBeat}–{job.job.endBeat}, {job.job.sampleRate}{' '}
                                Hz
                            </p>
                            <p className="mt-0.5 text-muted-foreground">Command {job.commandId}</p>
                            {job.availability === 'available' ? (
                                <>
                                    {job.warnings.length > 0 ? (
                                        <p className="mt-1 text-amber-300">{job.warnings.join('; ')}</p>
                                    ) : null}
                                    <Row gap={2} className="mt-1.5">
                                        <Button
                                            size="xs"
                                            variant="secondary"
                                            className="h-7 gap-1 text-[11px]"
                                            aria-label={`${playingJobKey === jobKey ? 'Stop' : 'Play'} ${job.job.sectionName}`}
                                            aria-pressed={playingJobKey === jobKey}
                                            disabled={isSettling}
                                            onClick={() => play(job)}
                                        >
                                            {playingJobKey === jobKey ? (
                                                <Square className="size-3" />
                                            ) : (
                                                <Play className="size-3" />
                                            )}
                                            {playingJobKey === jobKey ? 'Stop' : 'Play'}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="secondary"
                                            className="h-7 gap-1 text-[11px]"
                                            aria-label={`Export ${job.job.sectionName} WAV`}
                                            disabled={isSettling || workingJobKey !== null}
                                            onClick={() => void exportWav(job)}
                                        >
                                            <Download className="size-3" />
                                            Export WAV
                                        </Button>
                                    </Row>
                                </>
                            ) : (
                                <p className="mt-1 text-destructive">{job.reason}</p>
                            )}
                        </li>
                    );
                })}
            </Stack>
            {hasUnavailableEvidence ? (
                <Button
                    size="xs"
                    variant="secondary"
                    className="mt-2 h-7 text-[11px]"
                    disabled={isSettling}
                    onClick={() => settle('missing-evidence')}
                >
                    Acknowledge unavailable render evidence
                </Button>
            ) : (
                <Row gap={2} className="mt-2">
                    <Button
                        size="xs"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        aria-label="Accept retained render batch"
                        disabled={isSettling || workingJobKey !== null}
                        onClick={() => settle('accepted')}
                    >
                        Accept
                    </Button>
                    <Button
                        size="xs"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        aria-label="Discard retained render batch"
                        disabled={isSettling || workingJobKey !== null}
                        onClick={() => settle('discarded')}
                    >
                        Discard
                    </Button>
                </Row>
            )}
        </section>
    );
};
