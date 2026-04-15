import { type ReactElement } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useStore } from '#/infra/store/useStore';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { cancelRender } from '../../useCases/cancelRender';

type RenderProgressIndicatorProps = {
    phraseId: string;
};

/** Per-phrase render progress bar shown on the canvas */
export function RenderProgressIndicator({ phraseId }: RenderProgressIndicatorProps): ReactElement | null {
    const progressState = useStore(inferenceProgressStore, { activeRenders: {} });
    const queueState = useStore(renderQueueStore, { entries: [], cachedPhraseIds: [], phraseStatusMap: {} });

    const phraseStatus = queueState?.phraseStatusMap[phraseId];
    const activeRender = progressState
        ? Object.values(progressState.activeRenders).find((r) => r.phraseId === phraseId)
        : undefined;

    if (!phraseStatus || phraseStatus === 'not-rendered') {
        return null;
    }

    if (phraseStatus === 'preview') {
        return (
            <DawMicroBadge tone="success" role="status" aria-label="Preview render ready">
                <CheckCircle2 className="size-2.5" aria-hidden="true" />
                <span>Preview ready</span>
            </DawMicroBadge>
        );
    }

    if (phraseStatus === 'final') {
        return (
            <DawMicroBadge tone="success" role="status" aria-label="Final render ready">
                <CheckCircle2 className="size-2.5" aria-hidden="true" />
                <span>Final ready</span>
            </DawMicroBadge>
        );
    }

    if (phraseStatus === 'stale') {
        return (
            <DawMicroBadge
                tone="peach"
                role="status"
                aria-label="Phrase is stale — render needed"
                title="Edit invalidated render — click to re-render"
            >
                <span aria-hidden="true">●</span>
                <span>Stale</span>
            </DawMicroBadge>
        );
    }

    if (phraseStatus === 'queued') {
        const queueEntry = queueState?.entries.find((e) => e.phraseId === phraseId);
        const queuedRequestId = queueEntry?.requestId;
        const handleCancelQueued = (): void => {
            if (queuedRequestId) cancelRender({ phraseId, requestId: queuedRequestId });
        };
        return (
            <div className="flex items-center gap-2 px-2 py-1 text-[9px] bg-surface-overlay border border-border/40 rounded">
                <DawMicroBadge tone="muted" role="status" aria-label="Render queued">
                    Queued
                </DawMicroBadge>
                {queuedRequestId ? (
                    <button
                        type="button"
                        onClick={handleCancelQueued}
                        className="ml-auto shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        aria-label="Cancel queued render"
                        title="Cancel queued render"
                    >
                        ✕
                    </button>
                ) : null}
            </div>
        );
    }

    if (phraseStatus === 'error') {
        return (
            <DawMicroBadge
                tone="danger"
                role="alert"
                aria-label="Render failed"
            >
                ✕ Error
            </DawMicroBadge>
        );
    }

    // Active render (rendering-browser or rendering-native).
    // Guard: if inferenceProgressStore hasn't received startActiveRender yet (brief
    // transition) or this is a native render without browser-side progress tracking,
    // show a minimal pulsing badge rather than a broken 0% bar.
    if (!activeRender) {
        return (
            <DawMicroBadge tone="muted" role="status" aria-label="Rendering…">
                <span className="animate-pulse" aria-hidden="true">●</span>
                <span>Rendering…</span>
            </DawMicroBadge>
        );
    }

    const progress = activeRender.progress;
    const stage = activeRender.stage;
    const requestId = activeRender.requestId;

    const handleCancel = (): void => {
        cancelRender({ phraseId, requestId });
    };

    return (
        <div
            className="flex items-center gap-2 px-2 py-1 text-[9px] bg-surface-overlay border border-border/40 rounded min-w-[120px]"
            role="status"
            aria-label={`Rendering: ${stage}, ${Math.round(progress * 100)}%`}
        >
            <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                    <span className="text-muted-foreground truncate" title={stage}>{stage}</span>
                    <span className="text-muted-foreground/70 tabular-nums">{Math.round(progress * 100)}%</span>
                </div>
                <div className="w-full h-0.5 bg-border/40 rounded-full overflow-hidden" aria-hidden="true">
                    <div
                        className="h-full bg-[var(--color-accent-orange)] transition-all duration-300 ease-out"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                </div>
            </div>
            {requestId ? (
                <button
                    type="button"
                    onClick={handleCancel}
                    className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label="Cancel render"
                    title="Cancel render"
                >
                    ✕
                </button>
            ) : null}
        </div>
    );
}
