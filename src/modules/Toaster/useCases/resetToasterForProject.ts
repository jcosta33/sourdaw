import { resetToasterDeviceLifecycleState, toasterStore } from '../stores/toasterStore';

import { disposeEveryToasterDevice } from './disposeEveryToasterDevice';

/** End every Toaster of the outgoing project at a project switch (§13.1). */
export function resetToasterForProject(): void {
    // The graph reset that precedes a switch announces no device removal, so
    // the outgoing project's Toasters end here: their sequencer, note-repeat
    // and 16-Levels sessions would otherwise reach a same-id device of the
    // incoming project. Disposal reads the records, so it runs before they go.
    disposeEveryToasterDevice();
    toasterStore.set({});
    // The Toaster registration bookkeeping (deferred kit writes and retired
    // ids) is module-level state beside the store. Surviving a project
    // switch, it would either flush an abandoned write onto the incoming
    // project's same-id device — dirtying a just-loaded document — or refuse
    // its loading-window writes outright. Ids are per-document, so the
    // bookkeeping ends at the project boundary (§13.1).
    resetToasterDeviceLifecycleState();
}
