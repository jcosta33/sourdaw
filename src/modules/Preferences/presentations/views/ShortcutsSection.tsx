import { type ReactElement, useState, useEffect } from 'react';

import { Keyboard } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent } from '#/components/ui/dialog';
import { currentKeyboardLayoutMap, loadKeyboardLayoutMap } from '#/infra/keyboardLayout/keyboardLayoutMap';
import { useStore } from '#/infra/store/useStore';
import { shortcutStore, type ShortcutDefinition, type ShortcutStoreState } from '#/modules/CommandInterface/stores';
import {
    findShortcutConflicts,
    formatShortcutCombo,
    resetShortcutMappings,
    setShortcutMapping,
    shortcutComboFromKeyPress,
} from '#/modules/CommandInterface/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { cn } from '#/utils/Styles/cn';

import { CaptureKeyButton } from '../components/CaptureKeyButton';

import { SectionTitle } from './preferencesShared';

// §10.2 item 1 — This section used to read from a second, parallel
// `Workspace/models/Shortcuts.ts` store, which duplicated every binding
// the Command shortcut engine already owned. Both stores fired on the
// same keydown, leading to double-dispatched actions. The stores are
// now unified under `CommandInterface/stores/shortcutStore` — this component is
// the editor for that single source of truth.

const CATEGORY_ORDER: Record<ShortcutDefinition['category'], number> = {
    transport: 0,
    editing: 1,
    view: 2,
    workflow: 3,
};

const CATEGORY_LABELS: Record<ShortcutDefinition['category'], string> = {
    transport: 'Transport',
    editing: 'Editing',
    view: 'View',
    workflow: 'Workflow',
};

const CAPTURE_IGNORED_KEYS = ['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'];

/** A bare Escape ends the capture; Escape with modifiers (Shift+Escape is MIDI panic) is still bindable. */
function isCaptureCancel(event: KeyboardEvent): boolean {
    return event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Binds `combo` to the definition, asking first when other commands already
 * hold it (Logic Pro and REAPER key-command convention): confirming moves the
 * key to this command, cancelling changes nothing.
 */
async function assignShortcut(definitionId: string, combo: string): Promise<void> {
    const state = shortcutStore.value;
    const target = state?.definitions.find((definition) => definition.id === definitionId);
    if (!state || !target) {
        return;
    }
    const holders = findShortcutConflicts(state, definitionId, combo);
    if (holders.length > 0) {
        const holderLabels = holders.map((holder) => holder.label).join(', ');
        const reassign = await confirmUser({
            title: 'Shortcut already in use',
            message: `${formatShortcutCombo(combo)} is assigned to ${holderLabels}. Reassign it to ${target.label}?`,
            confirmLabel: 'Reassign',
        });
        if (!reassign) {
            return;
        }
    }
    setShortcutMapping(definitionId, combo);
}

function formatBinding(keys: string[]): string {
    return keys.length === 0 ? 'Unassigned' : keys.map(formatShortcutCombo).join(' / ');
}

function resetMappings(): void {
    resetShortcutMappings();
}

const FALLBACK_STATE: ShortcutStoreState = {
    definitions: [],
    customMappings: {},
};

export const ShortcutsSection = (): ReactElement => {
    const state = useStore<ShortcutStoreState>(shortcutStore, FALLBACK_STATE);
    const [editingId, setEditingId] = useState<string | null>(null);
    // A captured combo that another command holds waits on the reassignment
    // prompt. The capture stays open until that answer is applied, and stops
    // listening meanwhile so the prompt's own keys reach it.
    const [assigning, setAssigning] = useState(false);

    useEffect(() => {
        if (!editingId || assigning) {
            return undefined;
        }
        // Capture phase on window, ahead of the global shortcut listener and the
        // dialogs' own Escape handling, so the press binds and nothing else runs.
        const handleKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (CAPTURE_IGNORED_KEYS.includes(event.key)) {
                return;
            }
            if (isCaptureCancel(event)) {
                setEditingId(null);
                return;
            }
            setAssigning(true);
            void assignShortcut(editingId, shortcutComboFromKeyPress(event, currentKeyboardLayoutMap())).finally(() => {
                setAssigning(false);
                setEditingId(null);
            });
        };
        void loadKeyboardLayoutMap();
        window.addEventListener('keydown', handleKey, true);
        return () => window.removeEventListener('keydown', handleKey, true);
    }, [editingId, assigning]);

    // Group definitions by category and sort stably within each.
    const grouped = new Map<ShortcutDefinition['category'], ShortcutDefinition[]>();
    for (const def of state.definitions) {
        const bucket = grouped.get(def.category);
        if (bucket) {
            bucket.push(def);
        } else {
            grouped.set(def.category, [def]);
        }
    }
    for (const bucket of grouped.values()) {
        bucket.sort((alpha, b) => alpha.label.localeCompare(b.label));
    }

    const categories = [...grouped.keys()].sort(
        (alpha, b) => (CATEGORY_ORDER[alpha] ?? 999) - (CATEGORY_ORDER[b] ?? 999)
    );

    const editingDefinition = editingId
        ? (state.definitions.find((definition) => definition.id === editingId) ?? null)
        : null;

    return (
        <>
            <Row justify="between" className="mb-4">
                <SectionTitle icon={<Keyboard className="size-4" />} title="Keyboard Shortcuts" />
                <Button variant="ghost" size="xs" onClick={resetMappings} className="text-[10px] text-muted-foreground">
                    Reset to Defaults
                </Button>
            </Row>

            <Stack gap={4}>
                {categories.map((category) => (
                    <div key={category}>
                        <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            {CATEGORY_LABELS[category] ?? category}
                        </h3>
                        <div className="grid grid-cols-[1fr_auto] gap-y-2 gap-x-4">
                            {(grouped.get(category) ?? []).map((def) => {
                                const keys = state.customMappings[def.id] ?? def.defaultKeys;
                                const display = formatBinding(keys);
                                const isEditing = editingId === def.id;
                                return (
                                    <Row justify="between" className="group col-span-2" key={def.id}>
                                        <span className="text-xs text-muted-foreground">{def.label}</span>
                                        <CaptureKeyButton
                                            listening={isEditing}
                                            className={cn(
                                                'min-w-[80px] px-2 py-1 text-right text-xs',
                                                !isEditing && 'border-transparent hover:border-border'
                                            )}
                                            onClick={() => setEditingId(def.id)}
                                        >
                                            {isEditing ? 'Press keys...' : display}
                                        </CaptureKeyButton>
                                    </Row>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </Stack>

            <Dialog
                open={Boolean(editingDefinition)}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingId(null);
                    }
                }}
            >
                {editingDefinition ? (
                    <DialogContent
                        showCloseButton={false}
                        aria-modal="true"
                        aria-label={`Binding: ${editingDefinition.label}`}
                        className="w-full max-w-sm sm:max-w-sm p-0 border-none bg-transparent shadow-none"
                    >
                        <DawUtilityPanel className="w-full">
                            <DawHeaderBand
                                className="px-4 py-3"
                                startSlot={<Keyboard className="size-3.5 text-primary" />}
                                title={`Binding: ${editingDefinition.label}`}
                                titleClassName="text-[11px] text-foreground normal-case tracking-normal"
                            />
                            <Stack align="center" gap={3} className="px-4 py-5 text-center">
                                <Keyboard className="size-8 text-primary" />
                                <p className="text-sm text-muted-foreground">Press the desired key combination.</p>
                                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                    Cancel
                                </Button>
                            </Stack>
                        </DawUtilityPanel>
                    </DialogContent>
                ) : null}
            </Dialog>
        </>
    );
};
