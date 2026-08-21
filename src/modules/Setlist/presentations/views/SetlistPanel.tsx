import { type ReactElement, type DragEvent, useEffect, useRef, useState } from 'react';

import {
    Plus,
    Trash2,
    ChevronUp,
    ChevronDown,
    SkipBack,
    SkipForward,
    Play,
    Timer,
    Repeat,
    GripVertical,
} from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import { setlistStore, type SetlistState } from '../../stores/setlistStore';
import { addSetlistItem } from '../../useCases/setlist/addSetlistItem';
import { goToItem } from '../../useCases/setlist/goToItem';
import { nextItem } from '../../useCases/setlist/nextItem';
import { previousItem } from '../../useCases/setlist/previousItem';
import { removeSetlistItem } from '../../useCases/setlist/removeSetlistItem';
import { renameSetlist } from '../../useCases/setlist/renameSetlist';
import { reorderSetlistItems } from '../../useCases/setlist/reorderSetlistItems';
import { setCountIn } from '../../useCases/setlist/setCountIn';
import { toggleAutoAdvance } from '../../useCases/setlist/toggleAutoAdvance';
import { updateSetlistItem } from '../../useCases/setlist/updateSetlistItem';

const DEFAULT_STATE: SetlistState = {
    name: 'Untitled Setlist',
    items: [],
    currentIndex: 0,
    autoAdvance: false,
    countInBars: 1,
};

const formatDuration = (seconds: number): string => {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

type SetlistProgressDisplay = {
    currentLabel: string;
    remainingLabel: string;
};

// Derives directly from the `state` already subscribed via useStore rather
// than re-reading setlistStore.value (F11) — a non-reactive path that would
// silently desync if that subscription were ever narrowed.
const buildProgressDisplay = (state: SetlistState): SetlistProgressDisplay => {
    if (state.items.length === 0) {
        return { currentLabel: '0 of 0', remainingLabel: '0:00 remaining' };
    }
    const current = state.currentIndex + 1;
    const total = state.items.length;
    const remaining = state.items
        .slice(state.currentIndex)
        .reduce((sum, item) => sum + item.estimatedDuration + item.gapSeconds, 0);
    return {
        currentLabel: `${current} of ${total}`,
        remainingLabel: `${formatDuration(remaining)} remaining`,
    };
};

export const SetlistPanel = (): ReactElement => {
    const state = useStore(setlistStore, DEFAULT_STATE);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragFromIndexRef = useRef<number | null>(null);
    const [editingNameItemId, setEditingNameItemId] = useState<string | null>(null);
    const [editingSetlistName, setEditingSetlistName] = useState(false);
    const [countInText, setCountInText] = useState<string>(String(state.countInBars));

    const hasItems = state.items.length > 0;
    const progress = buildProgressDisplay(state);

    const handleDragStart = (index: number): void => {
        dragFromIndexRef.current = index;
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDrop = (index: number): void => {
        const from = dragFromIndexRef.current;
        if (from !== null && from !== index) {
            reorderSetlistItems(from, index);
        }
        dragFromIndexRef.current = null;
        setDragOverIndex(null);
    };

    const handleDragEnd = (): void => {
        dragFromIndexRef.current = null;
        setDragOverIndex(null);
    };

    const handleCommitName = (id: string, next: string): void => {
        const trimmed = next.trim();
        if (trimmed.length > 0) {
            updateSetlistItem(id, { name: trimmed });
        }
        setEditingNameItemId(null);
    };

    const handleCommitSetlistName = (next: string): void => {
        const trimmed = next.trim();
        if (trimmed.length > 0) {
            renameSetlist(trimmed);
        }
        setEditingSetlistName(false);
    };

    const handleAdd = (): void => {
        addSetlistItem(`Song ${state.items.length + 1}`);
    };

    useEffect(() => {
        setCountInText(String(state.countInBars));
    }, [state.countInBars]);

    const handleCountInChange = (raw: string): void => {
        // Hold the transient text locally so an out-of-range keystroke stays
        // visible instead of silently snapping back to the committed value
        // (the input was previously controlled directly on state.countInBars).
        setCountInText(raw);
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 8) {
            setCountIn(parsed);
        }
    };

    const handleCountInBlur = (): void => {
        const parsed = Number.parseInt(countInText, 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 8) {
            setCountInText(String(state.countInBars));
        }
    };

    return (
        <Stack className="h-full bg-surface-base">
            <Row gap={2} shrink={false} className="border-b border-border-hairline px-3 py-1.5">
                {editingSetlistName ? (
                    <DawCompactInput
                        size="micro"
                        className="w-48"
                        autoFocus
                        defaultValue={state.name}
                        onBlur={(event) => handleCommitSetlistName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                handleCommitSetlistName((event.target as HTMLInputElement).value);
                            } else if (event.key === 'Escape') {
                                setEditingSetlistName(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="text-xs font-semibold text-foreground hover:text-accent-cyan"
                        onClick={() => setEditingSetlistName(true)}
                    >
                        {state.name}
                    </button>
                )}

                <div className="text-[10px] text-muted-foreground">
                    <span className="text-foreground/80">{progress.currentLabel}</span>
                    <span className="mx-1">·</span>
                    <span>{progress.remainingLabel}</span>
                </div>

                <Row gap={1} className="ml-auto">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Previous item"
                                disabled={!hasItems}
                                onClick={previousItem}
                            >
                                <SkipBack className="size-3" aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Previous item</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Next item"
                                disabled={!hasItems}
                                onClick={nextItem}
                            >
                                <SkipForward className="size-3" aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Next item</TooltipContent>
                    </Tooltip>

                    <div className="mx-1 h-4 w-px bg-border-hairline" aria-hidden="true" />

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant={state.autoAdvance ? 'secondary' : 'ghost'}
                                size="xs"
                                aria-label={`Auto-advance: ${state.autoAdvance ? 'on' : 'off'}`}
                                aria-pressed={state.autoAdvance}
                                onClick={toggleAutoAdvance}
                            >
                                <Repeat className="size-3" aria-hidden="true" />
                                <span className="ml-1">Auto</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Auto-advance to next item</TooltipContent>
                    </Tooltip>

                    <Row gap={1} className="text-[10px] text-muted-foreground">
                        <Timer className="size-3" aria-hidden="true" />
                        <span>Count-in</span>
                        <DawCompactInput
                            size="micro"
                            align="center"
                            className="w-10"
                            type="number"
                            min={0}
                            max={8}
                            value={countInText}
                            onChange={(event) => handleCountInChange(event.target.value)}
                            onBlur={handleCountInBlur}
                            aria-label="Count-in bars"
                        />
                        <span>bars</span>
                    </Row>

                    <div className="mx-1 h-4 w-px bg-border-hairline" aria-hidden="true" />

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-label="Add setlist item"
                                data-testid="setlist-add-item"
                                onClick={handleAdd}
                            >
                                <Plus className="size-3" aria-hidden="true" />
                                <span className="ml-1">Add</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add item to setlist</TooltipContent>
                    </Tooltip>
                </Row>
            </Row>

            <div className="flex-1 overflow-y-auto">
                {hasItems ? (
                    <div role="list" aria-label="Setlist items">
                        {state.items.map((item, index) => {
                            const isCurrent = index === state.currentIndex;
                            const isEditing = editingNameItemId === item.id;
                            return (
                                <div
                                    key={item.id}
                                    role="listitem"
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', item.id);
                                        handleDragStart(index);
                                    }}
                                    onDragOver={(event) => handleDragOver(event, index)}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        handleDrop(index);
                                    }}
                                    onDragEnd={handleDragEnd}
                                    onClick={() => goToItem(index)}
                                    className={cn(
                                        'group flex items-center gap-2 border-b border-border-hairline px-2 py-1.5 cursor-pointer',
                                        isCurrent ? 'bg-surface-overlay' : 'hover:bg-surface-panel',
                                        dragOverIndex === index ? 'border-t-2 border-t-ring' : ''
                                    )}
                                >
                                    <Row
                                        as="span"
                                        justify="center"
                                        shrink={false}
                                        className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100"
                                        aria-hidden="true"
                                    >
                                        <GripVertical className="size-3" />
                                    </Row>

                                    <span
                                        className="h-5 w-1 shrink-0 rounded-full"
                                        style={{ backgroundColor: item.color }}
                                        aria-hidden="true"
                                    />

                                    <span
                                        className={cn(
                                            'w-6 shrink-0 text-center font-mono text-[10px]',
                                            isCurrent ? 'text-accent-cyan font-semibold' : 'text-muted-foreground'
                                        )}
                                    >
                                        {isCurrent ? (
                                            <Play className="mx-auto size-2.5" aria-hidden="true" />
                                        ) : (
                                            index + 1
                                        )}
                                    </span>

                                    <Row grow gap={2}>
                                        {isEditing ? (
                                            <DawCompactInput
                                                size="micro"
                                                autoFocus
                                                defaultValue={item.name}
                                                onClick={(event) => event.stopPropagation()}
                                                onBlur={(event) => handleCommitName(item.id, event.target.value)}
                                                onKeyDown={(event) => {
                                                    event.stopPropagation();
                                                    if (event.key === 'Enter') {
                                                        handleCommitName(
                                                            item.id,
                                                            (event.target as HTMLInputElement).value
                                                        );
                                                    } else if (event.key === 'Escape') {
                                                        setEditingNameItemId(null);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                className="truncate text-xs text-foreground hover:text-accent-cyan text-left"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setEditingNameItemId(item.id);
                                                }}
                                            >
                                                {item.name}
                                            </button>
                                        )}
                                    </Row>

                                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                                        {formatDuration(item.estimatedDuration)}
                                    </span>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                className={cn(
                                                    'size-5 rounded flex items-center justify-center text-[9px] font-bold transition-colors',
                                                    item.autoStop
                                                        ? 'bg-accent-mint/20 text-accent-mint'
                                                        : 'text-muted-foreground hover:text-foreground'
                                                )}
                                                aria-pressed={item.autoStop}
                                                aria-label={`AS: Auto-stop ${item.autoStop ? 'on' : 'off'}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    updateSetlistItem(item.id, { autoStop: !item.autoStop });
                                                }}
                                            >
                                                AS
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>Auto-stop after this item finishes</TooltipContent>
                                    </Tooltip>

                                    <Row gap={0.5} shrink={false} className="opacity-0 group-hover:opacity-100">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    aria-label="Move up"
                                                    disabled={index === 0}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        reorderSetlistItems(index, index - 1);
                                                    }}
                                                >
                                                    <ChevronUp className="size-3" aria-hidden="true" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Move up</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    aria-label="Move down"
                                                    disabled={index === state.items.length - 1}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        reorderSetlistItems(index, index + 1);
                                                    }}
                                                >
                                                    <ChevronDown className="size-3" aria-hidden="true" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Move down</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    aria-label={`Remove ${item.name}`}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        removeSetlistItem(item.id);
                                                    }}
                                                >
                                                    <Trash2 className="size-3" aria-hidden="true" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Remove item</TooltipContent>
                                        </Tooltip>
                                    </Row>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-6">
                        <DawEmptyState
                            title="No setlist items"
                            description='Click "Add" to queue a song or cue for live performance.'
                            action={
                                <Button variant="secondary" size="xs" onClick={handleAdd}>
                                    <Plus className="size-3" aria-hidden="true" />
                                    <span className="ml-1">Add first item</span>
                                </Button>
                            }
                        />
                    </div>
                )}
            </div>
        </Stack>
    );
};
