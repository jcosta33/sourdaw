import { type ReactElement, useState, useEffect } from 'react';

import { Keyboard } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { shortcutStore, type ShortcutDefinition, type ShortcutStoreState } from '#/modules/CommandInterface/stores';
import { resetShortcutMappings, setShortcutMapping } from '#/modules/CommandInterface/useCases';
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

/** Convert a captured `KeyboardEvent` to the combo string the store expects. */
function keyboardEventToCombo(event: KeyboardEvent): string {
    const modifiers: string[] = [];
    if (event.metaKey || event.ctrlKey) {
        modifiers.push('mod');
    }
    if (event.shiftKey) {
        modifiers.push('shift');
    }
    if (event.altKey) {
        modifiers.push('alt');
    }
    const key = event.key === ' ' ? 'Space' : event.key;
    return [...modifiers, key].join('+');
}

/** Render a combo string as a user-facing key label. Accepts any store combo. */
function formatCombo(combo: string): string {
    if (combo === '+') {
        return '+';
    }
    let keyPart: string;
    let modifiers: string[];
    if (combo.endsWith('++')) {
        keyPart = '+';
        modifiers = combo.slice(0, -2).split('+');
    } else {
        const parts = combo.split('+');
        const popped = parts.pop() ?? '';
        keyPart = popped;
        modifiers = parts;
    }

    const symbols: string[] = [];
    if (modifiers.includes('mod')) {
        symbols.push('⌘');
    }
    if (modifiers.includes('alt')) {
        symbols.push('⌥');
    }
    if (modifiers.includes('shift')) {
        symbols.push('⇧');
    }

    let key = keyPart;
    if (key === 'Space' || key === ' ') {
        key = 'Space';
    } else if (key === 'Enter') {
        key = '⏎';
    } else if (key === 'Backspace') {
        key = '⌫';
    } else if (key === 'Delete') {
        key = 'Del';
    } else if (key === 'Escape') {
        key = 'Esc';
    } else if (key.length === 1) {
        key = key.toUpperCase();
    }

    symbols.push(key);
    return symbols.join(' ');
}

function updateMapping(definitionId: string, combo: string): void {
    setShortcutMapping(definitionId, combo);
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

    useEffect(() => {
        if (!editingId) {
            return undefined;
        }
        const handleKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'].includes(event.key)) {
                return;
            }
            updateMapping(editingId, keyboardEventToCombo(event));
            setEditingId(null);
        };
        window.addEventListener('keydown', handleKey, true);
        return () => window.removeEventListener('keydown', handleKey, true);
    }, [editingId]);

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
                                const display = keys.map(formatCombo).join(' / ');
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

            {editingDefinition ? (
                <Row
                    justify="center"
                    className="fixed inset-0 z-50 bg-bg-scrim/90 px-4 backdrop-blur-[2px] pointer-events-auto"
                >
                    <DawUtilityPanel className="w-full max-w-sm">
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
                </Row>
            ) : null}
        </>
    );
};
