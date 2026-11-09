import { type ReactElement, useState, useRef, useEffect } from 'react';

import { ChevronDown, Plus, Copy, ListTree, Check, Edit2 } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Button } from '#/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';

import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { createArrangement } from '../../useCases/arrangement/createArrangement';
import { duplicateArrangement } from '../../useCases/arrangement/duplicateArrangement';
import { renameArrangement } from '../../useCases/arrangement/renameArrangement';
import { switchArrangement } from '../../useCases/arrangement/switchArrangement';

export const ArrangementSelector = (): ReactElement | null => {
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [focusedArrangementId, setFocusedArrangementId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const radioRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    // §212.1 — Typed default instead of non-null assertion on live value.
    const state = useStore(arrangementStore, defaultArrangementStoreState);

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingId]);

    if (!state) {
        return null;
    }

    // Only show the selector when there are multiple arrangements
    if (state.arrangements.length <= 1) {
        return null;
    }

    const currentArrangement = state.arrangements.find((alpha) => alpha.id === state.activeArrangementId);
    const navigableArrangements = state.arrangements.filter((arr) => arr.id !== editingId);
    const focusedRadioId = navigableArrangements.some((arr) => arr.id === focusedArrangementId)
        ? focusedArrangementId
        : null;
    const activeRadioId = navigableArrangements.some((arr) => arr.id === state.activeArrangementId)
        ? state.activeArrangementId
        : null;
    const radioTabStopId = focusedRadioId ?? activeRadioId ?? navigableArrangements[0]?.id;

    const handleCreate = () => {
        createArrangement(`Arrangement ${state.arrangements.length + 1}`);
        setOpen(false);
    };

    const handleDuplicate = () => {
        duplicateArrangement(state.activeArrangementId);
        setOpen(false);
    };

    const handleRenameSubmit = (id: string) => {
        if (editName.trim()) {
            renameArrangement(id, editName.trim());
        }
        setEditingId(null);
    };

    const handleSwitch = (id: string, name: string): void => {
        void switchArrangement(id).catch((error: unknown) => {
            logger.error(
                new Error(`Failed to switch arrangement "${id}"`, {
                    cause: error,
                })
            );
            notifyUser(`Failed to switch to "${name}"`, 'error');
        });
    };

    return (
        <div className="relative">
            <Popover
                open={open}
                onOpenChange={(nextOpen) => {
                    setOpen(nextOpen);
                    if (nextOpen) {
                        setFocusedArrangementId(state.activeArrangementId);
                    } else {
                        setEditingId(null);
                        setFocusedArrangementId(null);
                    }
                }}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                className="daw-readout-well flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-[11px] font-medium transition-colors hover:bg-white/[0.04]"
                                aria-label="Arrangement selector"
                            >
                                <ListTree className="size-3 text-muted-foreground/60" />
                                <span className="max-w-[120px] truncate text-foreground/70">
                                    {currentArrangement?.name ?? 'Arrangement'}
                                </span>
                                <ChevronDown className="size-2.5 text-muted-foreground/40" />
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Arrangement View Snapshots</TooltipContent>
                </Tooltip>
                <PopoverContent
                    align="start"
                    sideOffset={4}
                    role="menu"
                    aria-label="Arrangement menu"
                    className="daw-floating-surface w-56 rounded-md border border-border bg-surface-overlay py-1 select-none"
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        const openingRadioId = activeRadioId ?? navigableArrangements[0]?.id;
                        if (openingRadioId) {
                            radioRefs.current.get(openingRadioId)?.focus();
                        }
                    }}
                    onEscapeKeyDown={(event) => {
                        event.stopPropagation();
                        if (editingId) {
                            event.preventDefault();
                            setEditingId(null);
                        }
                    }}
                >
                    <DawMenuSectionLabel className="flex items-center justify-between px-3 py-1.5">
                        <span>Arrangements</span>
                    </DawMenuSectionLabel>

                    <div className="max-h-[300px] overflow-y-auto py-1">
                        {state.arrangements.map((arr) => {
                            const isActive = arr.id === state.activeArrangementId;
                            const isEditing = editingId === arr.id;

                            return (
                                <div key={arr.id} className="group mx-1 flex items-center rounded-sm">
                                    {isEditing ? (
                                        <DawCompactInput
                                            ref={inputRef}
                                            type="text"
                                            size="micro"
                                            className="mx-2 my-1 h-5 min-w-0 flex-1 border-primary/50 bg-background/50 px-1"
                                            value={editName}
                                            onChange={(event) => setEditName(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    handleRenameSubmit(arr.id);
                                                }
                                                event.stopPropagation();
                                            }}
                                            onBlur={() => handleRenameSubmit(arr.id)}
                                            onClick={(event) => event.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <div
                                                ref={(element) => {
                                                    if (element) {
                                                        radioRefs.current.set(arr.id, element);
                                                    } else {
                                                        radioRefs.current.delete(arr.id);
                                                    }
                                                }}
                                                role="menuitemradio"
                                                aria-checked={isActive}
                                                tabIndex={arr.id === radioTabStopId ? 0 : -1}
                                                className={cn(
                                                    'flex-1 cursor-pointer rounded-sm px-2 py-1',
                                                    isActive
                                                        ? 'bg-primary/10 text-primary font-medium'
                                                        : 'hover:bg-accent/50 text-foreground transition-colors'
                                                )}
                                                onClick={() => handleSwitch(arr.id, arr.name)}
                                                onFocus={() => setFocusedArrangementId(arr.id)}
                                                onKeyDown={(event) => {
                                                    if (event.target !== event.currentTarget) {
                                                        return;
                                                    }
                                                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        const direction = event.key === 'ArrowUp' ? -1 : 1;
                                                        const currentIndex = navigableArrangements.findIndex(
                                                            (candidate) => candidate.id === arr.id
                                                        );
                                                        const nextIndex =
                                                            (currentIndex + direction + navigableArrangements.length) %
                                                            navigableArrangements.length;
                                                        const nextArrangement = navigableArrangements[nextIndex];
                                                        if (nextArrangement) {
                                                            setFocusedArrangementId(nextArrangement.id);
                                                            radioRefs.current.get(nextArrangement.id)?.focus();
                                                        }
                                                        return;
                                                    }
                                                    if (event.key !== 'Enter' && event.key !== ' ') {
                                                        return;
                                                    }
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    handleSwitch(arr.id, arr.name);
                                                }}
                                            >
                                                <DawPickerRow
                                                    heading={arr.name}
                                                    active={isActive}
                                                    compact
                                                    className={cn(
                                                        'flex-1 border-0 bg-transparent px-0 py-0',
                                                        isActive ? 'hover:bg-transparent' : ''
                                                    )}
                                                    startSlot={
                                                        <div className="w-4">
                                                            {isActive ? <Check className="size-3" /> : null}
                                                        </div>
                                                    }
                                                    title={arr.name}
                                                />
                                            </div>
                                            <Button
                                                variant="bare"
                                                size="bare"
                                                type="button"
                                                aria-label={`Rename ${arr.name}`}
                                                className={cn(
                                                    'rounded p-0.5 transition-all hover:bg-background/80',
                                                    isActive
                                                        ? 'opacity-100'
                                                        : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                                                )}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setEditName(arr.name);
                                                    setEditingId(arr.id);
                                                }}
                                            >
                                                <Edit2 className="size-3" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <DawMenuSeparator role="separator" />

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleCreate}
                    >
                        <Plus className="size-3 text-muted-foreground shrink-0" />
                        <span>New Arrangement</span>
                    </Button>

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleDuplicate}
                    >
                        <Copy className="size-3 text-muted-foreground shrink-0" />
                        <span>Duplicate Current</span>
                    </Button>
                </PopoverContent>
            </Popover>
        </div>
    );
};
