import { type AppAction } from '../useCases/commandQueries';

const MAX_ACTION_REPLAY_CAPABILITIES = 200;

const action_replay_capabilities = new Map<string, AppAction>();

type RegisterActionReplayCapabilityInput = {
    entryId: string;
    inverseAction: AppAction;
};

function pruneActionReplayCapabilities(): void {
    while (action_replay_capabilities.size > MAX_ACTION_REPLAY_CAPABILITIES) {
        const oldest_entry_id = action_replay_capabilities.keys().next().value;
        if (oldest_entry_id === undefined) {
            return;
        }
        action_replay_capabilities.delete(oldest_entry_id);
    }
}

export function registerActionReplayCapability({ entryId, inverseAction }: RegisterActionReplayCapabilityInput): void {
    action_replay_capabilities.delete(entryId);
    action_replay_capabilities.set(entryId, inverseAction);
    pruneActionReplayCapabilities();
}

export function hasActionReplayCapability(entryId: string): boolean {
    return action_replay_capabilities.has(entryId);
}

export function claimActionReplayCapability(entryId: string): AppAction | null {
    const inverseAction = action_replay_capabilities.get(entryId);
    if (inverseAction === undefined) {
        return null;
    }

    action_replay_capabilities.delete(entryId);
    return inverseAction;
}

type RestoreActionReplayCapabilityInput = {
    entryId: string;
    inverseAction: AppAction;
};

export function restoreActionReplayCapability({ entryId, inverseAction }: RestoreActionReplayCapabilityInput): void {
    if (action_replay_capabilities.has(entryId)) {
        return;
    }

    action_replay_capabilities.set(entryId, inverseAction);
    pruneActionReplayCapabilities();
}

export function clearActionReplayCapabilities(): void {
    action_replay_capabilities.clear();
}
