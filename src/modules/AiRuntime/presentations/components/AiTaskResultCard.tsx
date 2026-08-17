import { type ReactElement } from 'react';

import { AudioWaveform, Loader2, Music4, Play, Plus, RefreshCw, X } from 'lucide-react';

import { DawUtilityListRow } from '#/components/daw/DawUtilityListRow';
import { Button } from '#/components/ui/button';

type AiTaskType = 'midi-generation' | 'stem-separation' | 'denoise';

type AiTaskStatus = 'idle' | 'processing' | 'success' | 'error';

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

type AiTaskResultCardProps = {
    task: AiTaskResultView;
    onRemove: (taskId: string) => void;
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

export const AiTaskResultCard = ({ task, onRemove }: AiTaskResultCardProps): ReactElement => (
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
                    aria-label="Remove task"
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
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent-lavender)]">
                    <Loader2 className="size-3 animate-spin" />
                    Processing...
                </div>
            ) : null}
            {task.status === 'error' ? <div className="text-[10px] text-destructive">{task.error}</div> : null}
            {task.status === 'success' ? (
                <div className="mt-1 flex items-center justify-between border-t border-border/30 pt-1">
                    <span className="text-[9px] text-muted-foreground/70">
                        {task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : 'Done'}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button variant="secondary" size="icon-xs" className="h-5 w-5 bg-surface-base" title="Preview">
                            <Play className="size-3 text-foreground" />
                        </Button>
                        <Button
                            variant="secondary"
                            size="icon-xs"
                            className="h-5 w-5 bg-surface-base"
                            title="Add to arrangement"
                        >
                            <Plus className="size-3 text-foreground" />
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    </div>
);
