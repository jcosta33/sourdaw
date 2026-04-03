import { type ReactElement, useSyncExternalStore, useState, useEffect } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '#/components/ui/button';
import {
    shortcutStore,
    updateShortcutBinding,
    resetShortcutsToDefault,
    formatKeyBinding,
    type ShortcutAction,
} from '../../models/Shortcuts';
import { cn } from '#/helpers/Styles/cn';
import { SectionTitle } from './preferencesShared';

// ── Action label map ──────────────────────────────────────────────────

const ACTION_LABELS: Record<ShortcutAction, string> = {
    PLAY_PAUSE: 'Play / Pause',
    STOP_RETURN: 'Stop (Return to 0)',
    RECORD_TOGGLE: 'Record',
    LOOP_TOGGLE: 'Loop Selection',
    UNDO: 'Undo',
    REDO: 'Redo',
    COPY: 'Copy Selected',
    PASTE: 'Paste',
    DELETE: 'Delete Selection',
    SPLIT_CLIP: 'Split Clip at Playhead',
    DUPLICATE: 'Duplicate',
    SAVE_PROJECT: 'Save Project',
    TOGGLE_MIXER: 'Open/Close Mixer',
    TOGGLE_INSPECTOR: 'Open/Close Inspector',
    TOGGLE_AI_ASSISTANT: 'Open/Close AI Chat',
};

// ── ShortcutsSection ──────────────────────────────────────────────────

export const ShortcutsSection = (): ReactElement => {
    const shortcutState = useSyncExternalStore(
        (cb) => shortcutStore.subscribe(() => cb()),
        () => shortcutStore.value,
        () => shortcutStore.value
    );

    const [editingAction, setEditingAction] = useState<ShortcutAction | null>(null);

    useEffect(() => {
        if (!editingAction) {
            return;
        }

        const handleGlobalKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Ignore standalone modifiers
            if (['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'].includes(e.key)) {
                return;
            }

            updateShortcutBinding(editingAction, {
                key: e.key,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
            });
            setEditingAction(null);
        };

        window.addEventListener('keydown', handleGlobalKey, true);
        return () => window.removeEventListener('keydown', handleGlobalKey, true);
    }, [editingAction]);

    if (!shortcutState) {
        return <></>;
    }

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <SectionTitle icon={<Keyboard className="size-4" />} title="Keyboard Shortcuts" />
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={resetShortcutsToDefault}
                    className="text-[10px] text-muted-foreground"
                >
                    Reset to Defaults
                </Button>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-y-2 gap-x-4">
                {Object.entries(ACTION_LABELS).map(([actionKey, label]) => {
                    const action = actionKey as ShortcutAction;
                    const binding = shortcutState.bindings[action];
                    const isEditing = editingAction === action;

                    return (
                        <div key={action} className="flex items-center justify-between group">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <button
                                type="button"
                                className={cn(
                                    'min-w-[80px] text-right rounded px-2 py-1 text-xs font-mono border transition-colors',
                                    isEditing
                                        ? 'border-primary bg-primary/10 text-primary animate-pulse'
                                        : 'border-transparent hover:border-border bg-surface-overlay text-foreground'
                                )}
                                onClick={() => setEditingAction(action)}
                            >
                                {isEditing ? 'Press keys...' : formatKeyBinding(binding)}
                            </button>
                        </div>
                    );
                })}
            </div>
            {editingAction ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto">
                    <div className="daw-floating-surface flex flex-col items-center gap-2 rounded-lg p-6">
                        <Keyboard className="size-8 text-primary mb-2" />
                        <h3 className="font-semibold text-lg">Binding: {ACTION_LABELS[editingAction]}</h3>
                        <p className="text-sm text-muted-foreground">Press the desired key combination.</p>
                        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setEditingAction(null)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </>
    );
};
