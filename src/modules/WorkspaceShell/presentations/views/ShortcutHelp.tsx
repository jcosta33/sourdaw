import { type ReactElement } from 'react';

import { useStore } from '#/infra/store/useStore';
import { shortcutStore, type ShortcutStoreState } from '#/modules/CommandInterface/stores';

import { ShortcutCheatSheet, type ShortcutRow } from '../components/ShortcutCheatSheet';
import { formatShortcutCombo } from '../helpers/formatShortcutCombo';

// Bindings the sheet lists from the store rather than by hand: a hand-written
// row said A selected the automation tool while the store binds it to the
// automation-visibility cycle.
const STORE_SHORTCUT_IDS = ['view.cycleAutomationVisibility', 'workspace.showAutomationPanel'];

const FALLBACK_STATE: ShortcutStoreState = { definitions: [], customMappings: {} };

const deriveStoreShortcuts = (state: ShortcutStoreState): ShortcutRow[] =>
    STORE_SHORTCUT_IDS.flatMap((id) => {
        const definition = state.definitions.find((candidate) => candidate.id === id);
        const combo = (state.customMappings[id] ?? definition?.defaultKeys)?.[0];
        if (definition === undefined || combo === undefined) {
            return [];
        }
        return [{ keys: formatShortcutCombo(combo), description: definition.label }];
    });

type ShortcutHelpProps = {
    onOpenChange?: (open: boolean) => void;
};

/** The shortcuts sheet, with the store-owned bindings read from the shortcut store the keyboard handler reads. */
export const ShortcutHelp = ({ onOpenChange }: ShortcutHelpProps): ReactElement => {
    const state = useStore<ShortcutStoreState>(shortcutStore, FALLBACK_STATE);
    return <ShortcutCheatSheet onOpenChange={onOpenChange} storeShortcuts={deriveStoreShortcuts(state)} />;
};
