import { type ReactElement, useState, useEffect } from 'react';
import { Button } from '#/components/ui/button';
import { X } from 'lucide-react';

type ShortcutGroup = {
    title: string;
    shortcuts: { keys: string; description: string }[];
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: 'Transport',
        shortcuts: [
            { keys: 'Space', description: 'Play / Pause' },
            { keys: 'Escape', description: 'Deselect / Stop' },
            { keys: 'R', description: 'Record' },
            { keys: 'L', description: 'Toggle loop' },
            { keys: 'M', description: 'Toggle metronome' },
            { keys: 'Home', description: 'Go to start' },
            { keys: 'End', description: 'Go to end' },
        ],
    },
    {
        title: 'Tools (letter)',
        shortcuts: [
            { keys: 'S', description: 'Select tool' },
            { keys: 'C', description: 'Cut / Split tool' },
            { keys: 'D', description: 'Draw tool' },
            { keys: 'A', description: 'Automation tool' },
            { keys: 'T', description: 'Stretch tool' },
        ],
    },
    {
        title: 'Tools (number)',
        shortcuts: [
            { keys: '1', description: 'Select tool' },
            { keys: '2', description: 'Cut tool' },
            { keys: '3', description: 'Draw tool' },
            { keys: '4', description: 'Automation tool' },
            { keys: '5', description: 'Stretch tool' },
        ],
    },
    {
        title: 'Editing',
        shortcuts: [
            { keys: '⌘ Z', description: 'Undo' },
            { keys: '⌘ ⇧ Z', description: 'Redo' },
            { keys: '⌘ C', description: 'Copy clip' },
            { keys: '⌘ X', description: 'Cut clip' },
            { keys: '⌘ V', description: 'Paste clip' },
            { keys: '⌘ D', description: 'Duplicate clip' },
            { keys: '⌥ D', description: 'Duplicate to next bar' },
            { keys: '⌘ A', description: 'Select all clips' },
            { keys: '⌘ ⇧ A', description: 'Deselect all' },
            { keys: 'Del', description: 'Delete selected' },
        ],
    },
    {
        title: 'Navigation',
        shortcuts: [
            { keys: '⌘ K', description: 'Command palette' },
            { keys: ']', description: 'Next marker' },
            { keys: '[', description: 'Previous marker' },
            { keys: 'Tab', description: 'Toggle arrange / clip' },
            { keys: 'V', description: 'Voice command (hold)' },
            { keys: '?', description: 'This shortcut sheet' },
        ],
    },
    {
        title: 'View / Zoom',
        shortcuts: [
            { keys: '= / +', description: 'Zoom in' },
            { keys: '-', description: 'Zoom out' },
            { keys: 'f', description: 'Zoom to fit' },
            { keys: '⇧ F', description: 'Zoom to selection' },
            { keys: '⇧ L', description: 'Scroll to playhead' },
            { keys: '⌘ ⇧ =', description: 'Zoom track heights in' },
            { keys: '⌘ ⇧ -', description: 'Zoom track heights out' },
        ],
    },
    {
        title: 'Tracks',
        shortcuts: [
            { keys: 'N', description: 'New MIDI track' },
            { keys: '⇧ N', description: 'New audio track' },
            { keys: '⌘ ⇧ D', description: 'Duplicate track' },
            { keys: '⌥ S', description: 'Clear all solos' },
        ],
    },
    {
        title: 'Project',
        shortcuts: [
            { keys: '⌘ S', description: 'Save project' },
            { keys: '⌘ ⇧ E', description: 'Export audio' },
            { keys: '⌘ ,', description: 'Preferences' },
        ],
    },
];

export const ShortcutCheatSheet = (): ReactElement | null => {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
            if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
            if (e.key === 'Escape' && open) {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open]);

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
            <div
                className="w-[560px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-raised p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Keyboard shortcuts"
                aria-modal="true"
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
                    <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="Close">
                        <X className="size-4" />
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    {SHORTCUT_GROUPS.map((group) => (
                        <div key={group.title}>
                            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                {group.title}
                            </h3>
                            <div className="space-y-1.5">
                                {group.shortcuts.map((s) => (
                                    <div key={s.keys} className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-foreground">{s.description}</span>
                                        <div className="flex gap-0.5">
                                            {s.keys.split(' ').map((k, i) => (
                                                <kbd
                                                    key={i}
                                                    className="min-w-[20px] rounded bg-surface-overlay px-1.5 py-0.5 text-center text-[10px] font-mono text-muted-foreground border border-border"
                                                >
                                                    {k}
                                                </kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <p className="mt-4 text-center text-[10px] text-muted-foreground">
                    Press{' '}
                    <kbd className="rounded bg-surface-overlay px-1 py-0.5 text-[10px] font-mono border border-border">
                        ?
                    </kbd>{' '}
                    to toggle this sheet
                </p>
            </div>
        </div>
    );
};
