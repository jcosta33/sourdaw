import { type ReactElement, type KeyboardEvent, useState, useRef } from 'react';

import { DawKeycap } from '#/components/daw/DawKeycap';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { closeCommandPalette } from '#/modules/WorkspaceShell/useCases';
import { cn } from '#/utils/Styles/cn';

import { searchCommands, type CommandEntry } from './commandRegistry';

export const CommandPalette = (): ReactElement | null => {
    const commandPaletteOpen = useStore(workspaceStore)?.commandPaletteOpen ?? false;
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const results = searchCommands(query);

    // Keep selection in range when results filter; a stale hover index here used
    // to fall out of bounds and swallow Enter (palette stayed open).
    const activeIndex = results.length > 0 ? Math.min(selectedIndex, results.length - 1) : -1;

    const [prevOpen, setPrevOpen] = useState(commandPaletteOpen);
    if (prevOpen !== commandPaletteOpen) {
        setPrevOpen(commandPaletteOpen);
        if (commandPaletteOpen) {
            setQuery('');
            setSelectedIndex(0);
        }
    }

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
        } else if (event.key === 'Enter' && results[activeIndex]) {
            event.preventDefault();
            execute(results[activeIndex]);
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
                <Row className="daw-header-band rounded-t-lg px-3">
                    <span className="text-sm text-muted-foreground mr-2">&gt;</span>
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command..."
                        className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base"
                        data-testid="command-palette-input"
                        autoFocus
                    />
                </Row>

                <div className="max-h-72 overflow-y-auto bg-surface-base py-1" role="listbox">
                    {results.map((cmd, index) => (
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            key={cmd.id}
                            role="option"
                            aria-selected={index === activeIndex}
                            className={cn(
                                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors border-l-2',
                                index === activeIndex
                                    ? 'bg-accent/80 border-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                                    : 'border-transparent text-muted-foreground hover:bg-surface-overlay/50'
                            )}
                            onClick={() => execute(cmd)} // Use pointermove (real cursor motion), not mouseenter:
                            // mouseenter fires when filtering shifts an option under a
                            // stationary cursor, clobbering keyboard nav with a stale index.
                            onPointerMove={() => setSelectedIndex(index)}
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
                        </Button>
                    ))}

                    {results.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">No commands found</p>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
};
