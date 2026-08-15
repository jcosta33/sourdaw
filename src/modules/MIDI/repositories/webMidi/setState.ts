import { type WebMidiState } from '../../models/WebMidiTypes';

import { persistInputId } from './persistInputId';
import { webMidiState, webMidiSubscribers } from './state';

type SetStateOptions = {
    /**
     * Whether a `selectedInputId` in this update is the user's choice and
     * should be remembered across sessions. A device that vanished on a
     * hot-unplug forces a session-only fallback, which must not overwrite the
     * saved preference — otherwise unplugging a controller for a second
     * permanently rebinds it to whatever enumerates first.
     */
    persistSelection?: boolean;
};

export function setState(next: Partial<WebMidiState>, options: SetStateOptions = {}): void {
    const { persistSelection = true } = options;
    webMidiState.current = { ...webMidiState.current, ...next };
    if (persistSelection && 'selectedInputId' in next) {
        persistInputId(next.selectedInputId ?? null);
    }
    for (const fn of webMidiSubscribers) {
        fn();
    }
}
