import { clearActionReplayCapabilities } from '../stores/actionReplayCapabilities';

export function resetActionReplayAuthority(): void {
    clearActionReplayCapabilities();
}
