import { type ReactElement, type KeyboardEvent, useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { cn } from "#/helpers/Styles/cn";
import { searchCommands, type CommandEntry } from "../../models/CommandRegistry";
import { executeAppAction } from "../../useCases/executeAppAction";
import type { AppAction } from "../../models/AppAction";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { useWorkspaceState } from "#/modules/Workspace/presentations/hooks/useWorkspaceState";

export const CommandPalette = (): ReactElement | null => {
    const { commandPaletteOpen } = useWorkspaceState();
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const results = searchCommands(query);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        if (commandPaletteOpen) {
            setQuery("");
            setSelectedIndex(0);
        }
    }, [commandPaletteOpen]);

    const close = () => {
        const ws = workspaceStore.value;
        if (ws) workspaceStore.set({ ...ws, commandPaletteOpen: false });
    };

    const execute = (entry: CommandEntry) => {
        close();
        if (typeof entry.action === "function") {
            entry.action();
        } else {
            void executeAppAction(entry.action as AppAction);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && results[selectedIndex]) {
            e.preventDefault();
            execute(results[selectedIndex]);
        }
    };

    return (
        <Dialog open={commandPaletteOpen} onOpenChange={(open) => { if (!open) close(); }}>
            <DialogContent className="max-w-md gap-0 overflow-hidden p-0" aria-describedby={undefined}>
                <DialogTitle className="sr-only">Command Palette</DialogTitle>
                <div className="flex items-center border-b border-border px-3">
                    <span className="text-sm text-muted-foreground mr-2">&gt;</span>
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command..."
                        className="h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm"
                        autoFocus
                    />
                </div>

                <div className="max-h-72 overflow-y-auto py-1" role="listbox">
                    {results.map((cmd, i) => (
                        <button
                            key={cmd.id}
                            role="option"
                            aria-selected={i === selectedIndex}
                            className={cn(
                                "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                                "hover:bg-accent/50",
                                i === selectedIndex && "bg-accent",
                            )}
                            onClick={() => execute(cmd)}
                            onMouseEnter={() => setSelectedIndex(i)}
                        >
                            <div>
                                <span className="text-foreground">{cmd.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{cmd.description}</span>
                            </div>
                            {cmd.shortcut && (
                                <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                                    {cmd.shortcut}
                                </kbd>
                            )}
                        </button>
                    ))}

                    {results.length === 0 && (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                            No commands found
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
