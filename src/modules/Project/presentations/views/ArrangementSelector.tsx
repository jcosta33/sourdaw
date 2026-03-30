import { type ReactElement, useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { ChevronDown, Plus, Copy, ListTree, Check, Edit2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { arrangementStore } from '../../stores/arrangementStore';
import {
    switchArrangement,
    createArrangement,
    duplicateArrangement,
    renameArrangement,
} from '../../useCases/arrangement';
import { cn } from '#/helpers/Styles/cn';

export const ArrangementSelector = (): ReactElement | null => {
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const state = useSyncExternalStore(
        (cb) => arrangementStore.subscribe(() => cb()),
        () => arrangementStore.value,
        () => arrangementStore.value
    );

    useEffect(() => {
        if (!open) {
            setEditingId(null);
            return;
        }

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (editingId) {
                    setEditingId(null);
                } else {
                    setOpen(false);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open, editingId]);

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingId]);

    if (!state) {
        return null;
    }

    const currentArrangement = state.arrangements.find((a) => a.id === state.activeArrangementId);

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

    return (
        <div className="relative" ref={menuRef}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 h-6 px-2 text-[11px] font-medium rounded-sm cursor-pointer hover:bg-white/[0.04] transition-colors"
                        style={{
                            background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                            border: '1px solid rgba(0,0,0,0.4)',
                            borderBottom: '1px solid rgba(40,40,40,0.3)',
                        }}
                        aria-label="Arrangement selector"
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={() => setOpen((prev) => !prev)}
                    >
                        <ListTree className="size-3 text-muted-foreground/60" />
                        <span className="max-w-[120px] truncate text-foreground/70">{currentArrangement?.name ?? 'Arrangement'}</span>
                        <ChevronDown className="size-2.5 text-muted-foreground/40" />
                    </button>
                </TooltipTrigger>
                <TooltipContent>Arrangement View Snapshots</TooltipContent>
            </Tooltip>

            {open ? (
                <div
                    className="absolute top-full left-0 mt-1 z-50 w-56 rounded-md border border-border bg-surface-overlay shadow-lg py-1 select-none"
                    role="menu"
                    aria-label="Arrangement menu"
                >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider flex items-center justify-between">
                        <span>Arrangements</span>
                    </div>

                    <div className="max-h-[300px] overflow-y-auto py-1">
                        {state.arrangements.map((arr) => {
                            const isActive = arr.id === state.activeArrangementId;
                            const isEditing = editingId === arr.id;

                            return (
                                <div
                                    key={arr.id}
                                    className={cn(
                                        'group flex items-center gap-2 px-2 py-1 mx-1 rounded-sm cursor-pointer',
                                        isActive
                                            ? 'bg-primary/10 text-primary font-medium'
                                            : 'hover:bg-accent/50 text-foreground transition-colors'
                                    )}
                                    onClick={() => {
                                        if (!isEditing && !isActive) {
                                            switchArrangement(arr.id);
                                        }
                                    }}
                                >
                                    <div className="w-4 flex items-center justify-center shrink-0">
                                        {isActive && !isEditing ? <Check className="size-3" /> : null}
                                    </div>

                                    {isEditing ? (
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            className="flex-1 min-w-0 bg-background/50 border border-primary/50 rounded px-1 text-xs h-5 focus:outline-none"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    handleRenameSubmit(arr.id);
                                                }
                                                e.stopPropagation();
                                            }}
                                            onBlur={() => handleRenameSubmit(arr.id)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <div
                                            className="flex-1 min-w-0 text-xs truncate"
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                setEditName(arr.name);
                                                setEditingId(arr.id);
                                            }}
                                        >
                                            {arr.name}
                                        </div>
                                    )}

                                    {!isEditing && (
                                        <button
                                            type="button"
                                            className={cn(
                                                'p-0.5 rounded hover:bg-background/80 transition-all',
                                                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditName(arr.name);
                                                setEditingId(arr.id);
                                            }}
                                        >
                                            <Edit2 className="size-3" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="mx-2 my-1 h-px bg-border" role="separator" />

                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleCreate}
                    >
                        <Plus className="size-3 text-muted-foreground shrink-0" />
                        <span>New Arrangement</span>
                    </button>

                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleDuplicate}
                    >
                        <Copy className="size-3 text-muted-foreground shrink-0" />
                        <span>Duplicate Current</span>
                    </button>
                </div>
            ) : null}
        </div>
    );
};
