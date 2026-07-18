import { type WebMidiState } from '../../models/WebMidiTypes';

import { persistInputId } from './persistInputId';
import { webMidiState, webMidiSubscribers } from './state';

export function setState(next: Partial<WebMidiState>): void {
    webMidiState.current = { ...webMidiState.current, ...next };
    if ('selectedInputId' in next) {
        persistInputId(next.selectedInputId ?? null);
    }
    for (const fn of webMidiSubscribers) {
        fn();
    }
}
