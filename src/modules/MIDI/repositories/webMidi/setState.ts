import { type WebMidiState } from '../../models/WebMidiTypes';

import { persistInputId } from './persistInputId';
import { type MidiIdentityScheme } from './selectedInputIdStorageKeys';
import { webMidiState, webMidiSubscribers } from './state';

/**
 * Persisting a selection is opt-in and must name the identity scheme the id
 * came from — the storage key is namespaced per scheme (#4138). Without it a
 * selection is session-only, the safe default: an accidental persist would
 * rebind the user's device across sessions, while a hot-unplug stand-in must
 * never overwrite the saved preference anyway (#1837 F10).
 */
type SetStateOptions = { persistSelection?: false } | { persistSelection: true; identityScheme: MidiIdentityScheme };

export function setState(next: Partial<WebMidiState>, options: SetStateOptions = {}): void {
    const merged: WebMidiState = { ...webMidiState.current, ...next };
    // A denial is one cause of `enumerationError`: a write that replaces the error without
    // saying it is a denial (a success clearing it, a native failure) ends the denial.
    if ('enumerationError' in next && !('accessDenied' in next)) {
        merged.accessDenied = false;
    }
    webMidiState.current = merged;
    if (options.persistSelection === true && 'selectedInputId' in next) {
        persistInputId(next.selectedInputId ?? null, options.identityScheme);
    }
    for (const fn of webMidiSubscribers) {
        fn();
    }
}
