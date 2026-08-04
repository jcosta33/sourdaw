/** Data shape shared by command-palette entries. Callable actions are supplied by the use-case layer. */

import { type AppAction } from '#/utils/handlerContract';

export type CommandEntry<Action = AppAction> = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: Action;
    /**
     * Optional presence gate, evaluated at search time. When supplied and it
     * returns false the entry is withheld from the palette entirely — for
     * capabilities whose backing resource may or may not be installed, so the
     * entry appears by itself once the resource is there.
     *
     * This is not for commands that are merely inapplicable right now (no clip
     * selected, transport stopped); those stay listed and explain themselves
     * when invoked.
     */
    isAvailable?: () => boolean;
};
