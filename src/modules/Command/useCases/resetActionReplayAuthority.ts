import { clearActionReplayCapabilities } from '../stores/actionReplayCapabilities';

import { recordedRedoBindings } from './recordedRedoBindings';

export function resetActionReplayAuthority(): void {
    clearActionReplayCapabilities();
    recordedRedoBindings.contexts = new WeakMap();
    recordedRedoBindings.actions = new WeakMap();
}
