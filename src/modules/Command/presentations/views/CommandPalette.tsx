import { type ReactElement, type KeyboardEvent, useState, useEffect, useRef } from 'react';

import { DawKeycap } from '#/components/daw/DawKeycap';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { useStore } from '#/infra/store/useStore';
import { workspaceStore } from '#/modules/Workspace/stores';
import { closeCommandPalette, type WorkspaceState } from '#/modules/Workspace/useCases';
import { cn } from '#/utils/Styles/cn';

import { searchCommands, type CommandEntry } from '../../models/CommandRegistry';
import { executeAppAction } from '../../useCases/executeAppAction';

export const CommandPalette = (): ReactElement | null => {
    const commandPaletteOpen = useStore(workspaceStore, null as unknown as WorkspaceState)?.commandPaletteOpen ?? false;
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const results = searchCommands(query);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        if (commandPaletteOpen) {
            setQuery('');
            setSelectedIndex(0);
        }
    }, [commandPaletteOpen]);

    const close = closeCommandPalette;

    const execute = (entry: CommandEntry) => {
        close();
        if (typeof entry.action === 'function') {
            entry.action();
        } else {
            void executeAppAction(entry.action);
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === 'Enter' && results[selectedIndex]) {
            event.preventDefault();
            execute(results[selectedIndex]);
        }
    };

    return (
        <Dialog
            open={commandPaletteOpen}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <DialogContent className="max-w-md gap-0 overflow-hidden p-0" aria-describedby={undefined}>
                <DialogTitle className="sr-only">Command Palette</DialogTitle>
                <div className="daw-header-band flex items-center rounded-t-lg px-3">
                    <span className="text-sm text-muted-foreground mr-2">&gt;</span>
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command..."
                        className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base"
                        autoFocus
                    />
                </div>

                <div className="max-h-72 overflow-y-auto bg-surface-base py-1" role="listbox">
                    {results.map((cmd, index) => (
                        <button
                            type="button"
                            key={cmd.id}
                            role="option"
                            aria-selected={index === selectedIndex}
                            className={cn(
                                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors border-l-2',
                                index === selectedIndex
                                    ? 'bg-accent/80 border-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                                    : 'border-transparent text-muted-foreground hover:bg-surface-overlay/50'
                            )}
                            onClick={() => execute(cmd)}
                            onMouseEnter={() => setSelectedIndex(index)}
                        >
                            <div>
                                <span className="text-foreground">{cmd.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                            </div>
                            {cmd.shortcut ? (
                                <DawKeycap compact className="bg-muted">
                                    {cmd.shortcut}
                                </DawKeycap>
                            ) : null}
                        </button>
                    ))}

                    {results.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">No commands found</p>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
};
