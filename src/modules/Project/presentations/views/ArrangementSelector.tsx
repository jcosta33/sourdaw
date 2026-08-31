import { type ReactElement, useState, useRef, useEffect, useLayoutEffect } from 'react';

import { ChevronDown, Plus, Copy, ListTree, Check, Edit2 } from 'lucide-react';
import { createPortal } from 'react-dom';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Button } from '#/components/ui/button';
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

const ARRANGEMENT_MENU_WIDTH = 14 * 16;
const VIEWPORT_EDGE_GAP = 12;

export const ArrangementSelector = (): ReactElement | null => {
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const triggerContainerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // §212.1 — Typed default instead of non-null assertion on live value.
    const state = useStore(arrangementStore, defaultArrangementStoreState);

    useEffect(() => {
        if (!open) {
            setEditingId(null);
            return undefined;
        }

        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const clickedTrigger = triggerContainerRef.current?.contains(target) ?? false;
            const clickedMenu = menuRef.current?.contains(target) ?? false;
            if (!clickedTrigger && !clickedMenu) {
                setOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
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

    useLayoutEffect(() => {
        if (!open) {
            return;
        }

        const triggerRect = triggerContainerRef.current?.getBoundingClientRect();
        const menuRect = menuRef.current?.getBoundingClientRect();
        if (!triggerRect || !menuRect) {
            return;
        }

        const menuWidth = Math.min(ARRANGEMENT_MENU_WIDTH, window.innerWidth - VIEWPORT_EDGE_GAP * 2);
        setMenuPosition({
            top: Math.min(
                Math.max(VIEWPORT_EDGE_GAP, triggerRect.bottom + 4),
                Math.max(VIEWPORT_EDGE_GAP, window.innerHeight - menuRect.height - VIEWPORT_EDGE_GAP)
            ),
            left: Math.min(
                Math.max(VIEWPORT_EDGE_GAP, triggerRect.left),
                window.innerWidth - menuWidth - VIEWPORT_EDGE_GAP
            ),
        });
    }, [open, state]);

    if (!state) {
        return null;
    }

    // Only show the selector when there are multiple arrangements
    if (state.arrangements.length <= 1) {
        return null;
    }

    const currentArrangement = state.arrangements.find((alpha) => alpha.id === state.activeArrangementId);

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
        <div className="relative" ref={triggerContainerRef}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="daw-readout-well flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-[11px] font-medium transition-colors hover:bg-white/[0.04]"
                        aria-label="Arrangement selector"
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={() => setOpen((previousOpen) => !previousOpen)}
                    >
                        <ListTree className="size-3 text-muted-foreground/60" />
                        <span className="max-w-[120px] truncate text-foreground/70">
                            {currentArrangement?.name ?? 'Arrangement'}
                        </span>
                        <ChevronDown className="size-2.5 text-muted-foreground/40" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Arrangement View Snapshots</TooltipContent>
            </Tooltip>
            {open
                ? createPortal(
                      <div
                          ref={menuRef}
                          className="daw-floating-surface fixed z-50 w-56 rounded-md border border-border bg-surface-overlay py-1 select-none"
                          style={{
                              ...menuPosition,
                              maxWidth: 'min(14rem, calc(100vw - 1.5rem))',
                              maxHeight: 'calc(100vh - 1.5rem)',
                              WebkitAppRegion: 'no-drag',
                          }}
                          role="menu"
                          aria-label="Arrangement menu"
                      >
                          <DawMenuSectionLabel className="flex items-center justify-between px-3 py-1.5">
                              <span>Arrangements</span>
                          </DawMenuSectionLabel>

                          <div className="max-h-[300px] overflow-y-auto py-1">
                              {state.arrangements.map((arr) => {
                                  const isActive = arr.id === state.activeArrangementId;
                                  const isEditing = editingId === arr.id;

                                  return (
                                      <div
                                          key={arr.id}
                                          className={cn(
                                              'group mx-1 rounded-sm px-2 py-1 cursor-pointer',
                                              isActive
                                                  ? 'bg-primary/10 text-primary font-medium'
                                                  : 'hover:bg-accent/50 text-foreground transition-colors'
                                          )}
                                          onClick={() => {
                                              if (!isEditing) {
                                                  void switchArrangement(arr.id).catch((error: unknown) => {
                                                      logger.error(
                                                          new Error(`Failed to switch arrangement "${arr.id}"`, {
                                                              cause: error,
                                                          })
                                                      );
                                                      notifyUser(`Failed to switch to "${arr.name}"`, 'error');
                                                  });
                                              }
                                          }}
                                      >
                                          {isEditing ? (
                                              <DawCompactInput
                                                  ref={inputRef}
                                                  type="text"
                                                  size="micro"
                                                  className="h-5 flex-1 min-w-0 border-primary/50 bg-background/50 px-1"
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
                                                  endSlot={
                                                      <Button
                                                          variant="bare"
                                                          size="bare"
                                                          type="button"
                                                          className={cn(
                                                              'rounded p-0.5 transition-all hover:bg-background/80',
                                                              isActive
                                                                  ? 'opacity-100'
                                                                  : 'opacity-0 group-hover:opacity-100'
                                                          )}
                                                          onClick={(event) => {
                                                              event.stopPropagation();
                                                              setEditName(arr.name);
                                                              setEditingId(arr.id);
                                                          }}
                                                      >
                                                          <Edit2 className="size-3" />
                                                      </Button>
                                                  }
                                                  title={arr.name}
                                              />
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
                      </div>,
                      document.body
                  )
                : null}
        </div>
    );
};
