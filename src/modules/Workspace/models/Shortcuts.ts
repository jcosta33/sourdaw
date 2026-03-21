import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

export type ShortcutAction =
    | 'PLAY_PAUSE'
    | 'STOP_RETURN'
    | 'RECORD_TOGGLE'
    | 'LOOP_TOGGLE'
    | 'UNDO'
    | 'REDO'
    | 'COPY'
    | 'PASTE'
    | 'DELETE'
    | 'SPLIT_CLIP'
    | 'DUPLICATE'
    | 'SAVE_PROJECT'
    | 'TOGGLE_MIXER'
    | 'TOGGLE_INSPECTOR'
    | 'TOGGLE_AI_ASSISTANT';

export type KeyBinding = {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
};

export type ShortcutMap = Record<ShortcutAction, KeyBinding>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
    PLAY_PAUSE: { key: ' ' },
    STOP_RETURN: { key: 'Enter' },
    RECORD_TOGGLE: { key: 'r' },
    LOOP_TOGGLE: { key: 'l' },
    UNDO: { key: 'z', metaKey: true },
    REDO: { key: 'z', metaKey: true, shiftKey: true },
    COPY: { key: 'c', metaKey: true },
    PASTE: { key: 'v', metaKey: true },
    DELETE: { key: 'Backspace' },
    SPLIT_CLIP: { key: 'e', metaKey: true },
    DUPLICATE: { key: 'd', metaKey: true },
    SAVE_PROJECT: { key: 's', metaKey: true },
    TOGGLE_MIXER: { key: 'm', altKey: true },
    TOGGLE_INSPECTOR: { key: 'i', altKey: true },
    TOGGLE_AI_ASSISTANT: { key: 'k', metaKey: true },
};

export type ShortcutState = {
    bindings: ShortcutMap;
};

const logger = Container.getInstance().get(Logger);

const loadFromLocalStorage = (): ShortcutMap => {
    try {
        const stored = localStorage.getItem('webdaw_shortcuts');
        if (stored) {
            return JSON.parse(stored) as ShortcutMap;
        }
    } catch {
        // Fallback
    }
    return DEFAULT_SHORTCUTS;
};

export const shortcutStore = new Store<ShortcutState>(logger, {
    initialData: {
        bindings: loadFromLocalStorage(),
    },
});

export function updateShortcutBinding(action: ShortcutAction, binding: KeyBinding): void {
    const state = shortcutStore.value;
    if (!state) {
        return;
    }

    const newBindings = { ...state.bindings, [action]: binding };
    shortcutStore.set({ bindings: newBindings });
    localStorage.setItem('webdaw_shortcuts', JSON.stringify(newBindings));
}

export function resetShortcutsToDefault(): void {
    shortcutStore.set({ bindings: DEFAULT_SHORTCUTS });
    localStorage.setItem('webdaw_shortcuts', JSON.stringify(DEFAULT_SHORTCUTS));
}

export const formatKeyBinding = (binding: KeyBinding): string => {
    const parts = [];
    if (binding.metaKey) {
        parts.push('⌘');
    }
    if (binding.ctrlKey) {
        parts.push('Ctrl');
    }
    if (binding.altKey) {
        parts.push('⌥');
    }
    if (binding.shiftKey) {
        parts.push('⇧');
    }

    let keyName = binding.key.toUpperCase();
    if (keyName === ' ') {
        keyName = 'Space';
    }
    if (keyName === 'BACKSPACE') {
        keyName = '⌫';
    }
    if (keyName === 'ENTER') {
        keyName = '⏎';
    }

    parts.push(keyName);
    return parts.join(binding.metaKey || binding.altKey || binding.shiftKey ? '' : '+');
};
