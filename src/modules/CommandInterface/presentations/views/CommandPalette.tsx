import { type ReactElement, type KeyboardEvent, useState, useRef } from 'react';

import { DawKeycap } from '#/components/daw/DawKeycap';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { useStore } from '#/infra/store/useStore';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { closeCommandPalette } from '#/modules/WorkspaceShell/useCases';
import { cn } from '#/utils/Styles/cn';

import { getCommandInapplicabilityReason } from '../../useCases/getCommandInapplicabilityReason';

import { discoverCommands, searchCommands, updateRecentCommandIds, type CommandEntry } from './commandRegistry';

type CommandOptionProps = {
    cmd: CommandEntry;
    index: number;
    activeIndex: number;
    onSelect: () => void;
    onHover: () => void;
};

const CommandOption = ({ cmd, index, activeIndex, onSelect, onHover }: CommandOptionProps): ReactElement => {
    const isSelected = index === activeIndex;
    const inapplicabilityReason = getCommandInapplicabilityReason(cmd);

    return (
        <Button
            variant="bare"
            size="bare"
            type="button"
            id={`command-palette-option-${cmd.id}`}
            role="option"
            aria-selected={isSelected}
            aria-disabled={inapplicabilityReason !== null}
            className={cn(
                'flex w-full items-center justify-between border-l-2 px-4 py-3 text-left text-sm transition-colors',
                isSelected
                    ? 'border-primary bg-accent/80 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                    : 'border-transparent text-muted-foreground hover:bg-surface-overlay/50'
            )}
            onClick={onSelect}
            // Real pointer motion may select an option; filtering-induced
            // mouseenter events must not clobber the keyboard's active index.
            onPointerMove={onHover}
        >
            <div className="min-w-0">
                <span className="text-foreground">{cmd.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                {inapplicabilityReason ? (
                    <span className="mt-1 block text-xs text-[var(--color-state-warning)]">
                        {inapplicabilityReason}
                    </span>
                ) : null}
            </div>
            {cmd.shortcut ? (
                <DawKeycap compact className="shrink-0 bg-muted">
                    {cmd.shortcut}
                </DawKeycap>
            ) : null}
        </Button>
    );
};

type CommandGroup = {
    id: string;
    label: string | null;
    entries: CommandEntry[];
};

type CommandListboxProps = {
    id: string;
    groups: CommandGroup[];
    activeIndex: number;
    onSelect: (entry: CommandEntry) => void;
    onHover: (index: number) => void;
};

const CommandListbox = ({ id, groups, activeIndex, onSelect, onHover }: CommandListboxProps): ReactElement => {
    let nextIndex = 0;
    const indexedGroups = groups.map((group) => ({
        ...group,
        entries: group.entries.map((cmd) => ({ cmd, index: nextIndex++ })),
    }));
    const resultCount = groups.reduce((count, group) => count + group.entries.length, 0);

    return (
        <div id={id} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto bg-surface-base py-1">
            {indexedGroups.map((group, groupIndex) => {
                const headingId = `command-palette-group-${groupIndex}`;
                const options = group.entries.map(({ cmd, index }) => (
                    <CommandOption
                        key={cmd.id}
                        cmd={cmd}
                        index={index}
                        activeIndex={activeIndex}
                        onSelect={() => onSelect(cmd)}
                        onHover={() => onHover(index)}
                    />
                ));

                return group.label ? (
                    <section key={group.id} role="group" aria-labelledby={headingId}>
                        <h2
                            id={headingId}
                            className="px-4 pb-1 pt-2 text-[length:var(--text-nano)] font-medium uppercase tracking-wide text-muted-foreground"
                        >
                            {group.label}
                        </h2>
                        {options}
                    </section>
                ) : (
                    <div key={group.id}>{options}</div>
                );
            })}

            {resultCount === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">No commands found</p>
            ) : null}
        </div>
    );
};

export const CommandPalette = (): ReactElement | null => {
    const commandPaletteOpen = useStore(workspaceStore)?.commandPaletteOpen ?? false;
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    // Session-only component state: recents never enter project or undo history.
    const [recentCommandIds, setRecentCommandIds] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const results = searchCommands(query);
    let groups: CommandGroup[];
    if (query.trim()) {
        groups = [{ id: 'search-results', label: null, entries: results }];
    } else {
        groups = discoverCommands(results, recentCommandIds);
    }
    const flattenedResults = groups.flatMap((group) => group.entries);

    // Every keyboard and active-descendant lookup uses the same visual order
    // as the grouped list, including when recents reorder empty-query results.
    const activeIndex = flattenedResults.length > 0 ? Math.min(selectedIndex, flattenedResults.length - 1) : -1;
    const listboxId = 'command-palette-listbox';
    const activeCommand = flattenedResults[activeIndex];
    const activeOptionId = activeCommand ? `command-palette-option-${activeCommand.id}` : undefined;

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
        if (getCommandInapplicabilityReason(entry) !== null) {
            return;
        }
        const onCommitted = () => {
            setRecentCommandIds((recentIds) => updateRecentCommandIds(recentIds, entry.id));
        };
        close();
        if (typeof entry.action === 'function') {
            entry.action(onCommitted);
        } else {
            void executeUserAppAction(entry.action, { onCommitted });
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((index) => Math.min(index + 1, flattenedResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === 'Enter' && activeCommand) {
            event.preventDefault();
            execute(activeCommand);
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
            <DialogContent
                className="max-w-md gap-0 overflow-hidden p-0"
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    inputRef.current?.focus();
                }}
            >
                <DialogTitle className="sr-only">Command Palette</DialogTitle>
                <Row className="daw-header-band rounded-t-lg px-3">
                    <span className="mr-2 text-sm text-muted-foreground">&gt;</span>
                    <Input
                        ref={inputRef}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={commandPaletteOpen}
                        aria-haspopup="listbox"
                        aria-controls={listboxId}
                        aria-activedescendant={activeOptionId}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command..."
                        className="h-12 border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
                        data-testid="command-palette-input"
                    />
                </Row>

                <CommandListbox
                    id={listboxId}
                    groups={groups}
                    activeIndex={activeIndex}
                    onSelect={execute}
                    onHover={setSelectedIndex}
                />
            </DialogContent>
        </Dialog>
    );
};
