import { type ReactElement, useState, useEffect } from 'react';
import { Keyboard } from 'lucide-react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import {
    shortcutStore,
    updateShortcutBinding,
    resetShortcutsToDefault,
    formatKeyBinding,
    type ShortcutAction,
    DEFAULT_SHORTCUTS,
    type ShortcutState,
} from '../../models/Shortcuts';
import { cn } from '#/utils/Styles/cn';
import { CaptureKeyButton } from '../components/CaptureKeyButton';
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
    const shortcutState = useStore<ShortcutState>(shortcutStore, { bindings: DEFAULT_SHORTCUTS });

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
                            <CaptureKeyButton
                                listening={isEditing}
                                className={cn(
                                    'min-w-[80px] px-2 py-1 text-right text-xs',
                                    !isEditing && 'border-transparent hover:border-border'
                                )}
                                onClick={() => setEditingAction(action)}
                            >
                                {isEditing ? 'Press keys...' : formatKeyBinding(binding)}
                            </CaptureKeyButton>
                        </div>
                    );
                })}
            </div>
            {editingAction ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-scrim/90 px-4 backdrop-blur-[2px] pointer-events-auto">
                    <DawUtilityPanel className="w-full max-w-sm">
                        <DawHeaderBand
                            className="px-4 py-3"
                            startSlot={<Keyboard className="size-3.5 text-primary" />}
                            title={`Binding: ${ACTION_LABELS[editingAction]}`}
                            titleClassName="text-[11px] text-foreground normal-case tracking-normal"
                        />
                        <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
                            <Keyboard className="size-8 text-primary" />
                            <p className="text-sm text-muted-foreground">Press the desired key combination.</p>
                            <Button variant="ghost" size="sm" onClick={() => setEditingAction(null)}>
                                Cancel
                            </Button>
                        </div>
                    </DawUtilityPanel>
                </div>
            ) : null}
        </>
    );
};
