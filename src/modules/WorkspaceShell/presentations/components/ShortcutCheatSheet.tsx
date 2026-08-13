import { type ReactElement, useState, useEffect } from 'react';

import { X } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawKeycap } from '#/components/daw/DawKeycap';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';

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
    {
        title: 'Loop Station (arm first)',
        shortcuts: [
            { keys: '1 … 8', description: 'Play row 1, tracks 1–8' },
            { keys: 'Q … I', description: 'Play row 2, tracks 1–8' },
            { keys: 'A … K', description: 'Play row 3, tracks 1–8' },
            { keys: 'Z … ,', description: 'Play row 4, tracks 1–8' },
            { keys: '⇧ pad', description: 'Record / re-record slot' },
            { keys: 'Esc', description: 'Stop all loop slots' },
        ],
    },
];

type ShortcutCheatSheetProps = {
    /**
     * Notified whenever the sheet opens or closes. The sheet is an `aria-modal`
     * overlay with a focus trap, so AppShell must know it is up in order to drop the
     * skip-link from the tab order — otherwise a keyboard user can tab to
     * "Skip to content" and jump to #main-content behind this dialog.
     * This component is a leaf `presentations/components/`: it may not read workspace
     * state or call use cases directly, so it reports upward instead.
     */
    onOpenChange?: (open: boolean) => void;
};

export const ShortcutCheatSheet = ({ onOpenChange }: ShortcutCheatSheetProps = {}): ReactElement | null => {
    const [open, setOpen] = useState(false);

    const setOpenAndReport = (next: boolean): void => {
        setOpen(next);
        onOpenChange?.(next);
    };

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
            if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
                event.preventDefault();
                setOpenAndReport(!open);
            }
            if (event.key === 'Escape' && open) {
                setOpenAndReport(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onOpenChange]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-scrim/90 px-4 backdrop-blur-[2px]"
            onClick={() => setOpenAndReport(false)}
        >
            <DawUtilityPanel
                className="w-[560px] max-h-[80vh]"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-label="Keyboard shortcuts"
                aria-modal="true"
            >
                <DawHeaderBand
                    className="px-4 py-3"
                    title="Keyboard Shortcuts"
                    titleClassName="text-[11px] text-foreground"
                    actions={
                        <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="Close">
                            <X className="size-4" />
                        </Button>
                    }
                />

                <div className="grid grid-cols-2 gap-6 overflow-y-auto px-4 py-4">
                    {SHORTCUT_GROUPS.map((group) => (
                        <div key={group.title}>
                            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                {group.title}
                            </h3>
                            <div className="space-y-1.5">
                                {group.shortcuts.map((state) => (
                                    <div key={state.keys} className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-foreground">{state.description}</span>
                                        <div className="flex gap-0.5">
                                            {state.keys.split(' ').map((kIndex, index) => (
                                                <DawKeycap key={`${state.keys}-${index}`} compact>
                                                    {kIndex}
                                                </DawKeycap>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <p className="px-4 py-3 text-center text-[10px] text-muted-foreground">
                    Press{' '}
                    <DawKeycap compact className="px-1">
                        ?
                    </DawKeycap>{' '}
                    to toggle this sheet
                </p>
            </DawUtilityPanel>
        </div>
    );
};
