import { type ReactElement } from 'react';

import { AudioWaveform, Crosshair, Loader2, Music4, Play, RefreshCw, Square, X } from 'lucide-react';

import { DawUtilityListRow } from '#/components/daw/DawUtilityListRow';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

type AiTaskType = 'midi-generation' | 'stem-separation' | 'denoise';

type AiTaskStatus = 'idle' | 'processing' | 'success' | 'error';

// Local view mirror of the generation task: presentation components read the
// store through this shape rather than importing the business store's types.
type AiTaskResultView = {
    id: string;
    type: AiTaskType;
    status: AiTaskStatus;
    prompt?: string;
    timestamp: number;
    error?: string;
    data?: unknown;
    durationMs?: number;
};

// The panel supplies these only for a task whose payload carries a committed
// clip it can act on; absent actions must mean absent buttons, never a dead
// enabled control.
export type CommittedClipActions = {
    isPreviewing: boolean;
    togglePreview: () => void;
    select: () => void;
};

type AiTaskResultCardProps = {
    task: AiTaskResultView;
    onRemove: (taskId: string) => void;
    committedClipActions?: CommittedClipActions;
};

const getTaskIcon = (type: AiTaskResultView['type']): ReactElement => {
    if (type === 'midi-generation') {
        return <Music4 className="size-3 text-[var(--color-accent-mint)]" />;
    }
    if (type === 'stem-separation') {
        return <RefreshCw className="size-3 text-[var(--color-accent-peach)]" />;
    }
    return <AudioWaveform className="size-3 text-[var(--color-accent-lavender)]" />;
};

export const AiTaskResultCard = ({ task, onRemove, committedClipActions }: AiTaskResultCardProps): ReactElement => (
    <div className="group rounded-md border border-border/40 bg-surface-raised p-2 text-xs transition-colors hover:border-[var(--color-accent-lavender)]/40">
        <DawUtilityListRow
            className="px-0 py-0"
            startSlot={getTaskIcon(task.type)}
            title={<span className="capitalize leading-none">{task.type.replace('-', ' ')}</span>}
            endSlot={
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
                    onClick={() => onRemove(task.id)}
                    aria-label="Remove task result"
                >
                    <X className="size-3" />
                </Button>
            }
        />

        {task.prompt ? (
            <div className="mt-1 text-[10px] italic text-muted-foreground line-clamp-2">"{task.prompt}"</div>
        ) : null}

        <div className="mt-2">
            {task.status === 'processing' ? (
                <Row gap={1.5} className="text-[10px] text-[var(--color-accent-lavender)]">
                    <Loader2 className="size-3 animate-spin" />
                    Processing...
                </Row>
            ) : null}
            {task.status === 'error' ? <div className="text-[10px] text-destructive">{task.error}</div> : null}
            {task.status === 'success' ? (
                <Row justify="between" className="mt-1 border-t border-border/30 pt-1">
                    <span className="text-[9px] text-muted-foreground/70">
                        {task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : 'Done'}
                    </span>
                    {committedClipActions ? (
                        <Row gap={1}>
                            <Button
                                variant="secondary"
                                size="icon-xs"
                                className="h-5 w-5 bg-surface-base"
                                title={committedClipActions.isPreviewing ? 'Stop preview' : 'Preview'}
                                aria-label={
                                    committedClipActions.isPreviewing ? 'Stop clip preview' : 'Preview task result'
                                }
                                onClick={committedClipActions.togglePreview}
                            >
                                {committedClipActions.isPreviewing ? (
                                    <Square className="size-3 text-foreground" />
                                ) : (
                                    <Play className="size-3 text-foreground" />
                                )}
                            </Button>
                            {/* Generation already committed and selected the clip, so
                                this re-focuses the existing material instead of promising
                                a second apply step the flow does not have. */}
                            <Button
                                variant="secondary"
                                size="icon-xs"
                                className="h-5 w-5 bg-surface-base"
                                title="Select clip"
                                aria-label="Select generated clip"
                                onClick={committedClipActions.select}
                            >
                                <Crosshair className="size-3 text-foreground" />
                            </Button>
                        </Row>
                    ) : null}
                </Row>
            ) : null}
        </div>
    </div>
);
