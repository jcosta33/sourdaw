import { type ReactElement, type KeyboardEvent, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { cn } from '#/helpers/Styles/cn';
import { searchCommands, type CommandEntry } from '../../models/CommandRegistry';
import { executeAppAction } from '../../useCases/executeAppAction';
import { closeCommandPalette } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

const subscribe = (cb: () => void): (() => void) => workspaceStore.subscribe(cb);
const getCommandPaletteOpen = (): boolean => workspaceStore.value?.commandPaletteOpen ?? false;

export const CommandPalette = (): ReactElement | null => {
    const commandPaletteOpen = useSyncExternalStore(subscribe, getCommandPaletteOpen, () => false);
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

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && results[selectedIndex]) {
            e.preventDefault();
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
                <div
                    className="flex items-center px-3"
                    style={{
                        background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px 8px 0 0',
                    }}
                >
                    <span className="text-sm text-muted-foreground mr-2">&gt;</span>
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command..."
                        className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base"
                        autoFocus
                    />
                </div>

                <div className="max-h-72 overflow-y-auto py-1" style={{ background: 'linear-gradient(180deg, #0a0a0a 0%, #0e0e0e 100%)' }} role="listbox">
                    {results.map((cmd, i) => (
                        <button
                            type="button"
                            key={cmd.id}
                            role="option"
                            aria-selected={i === selectedIndex}
                            className={cn(
                                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors border-l-2',
                                i === selectedIndex
                                    ? 'bg-accent/80 border-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                                    : 'border-transparent text-muted-foreground hover:bg-surface-overlay/50'
                            )}
                            onClick={() => execute(cmd)}
                            onMouseEnter={() => setSelectedIndex(i)}
                        >
                            <div>
                                <span className="text-foreground">{cmd.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                            </div>
                            {cmd.shortcut ? (
                                <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                                    {cmd.shortcut}
                                </kbd>
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
