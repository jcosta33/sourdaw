import { type AppAction } from '../useCases/commandQueries';

const MAX_ACTION_REPLAY_CAPABILITIES = 200;

type ActionReplayClaim = {
    readonly inverseAction: AppAction;
    readonly generation: number;
};

const action_replay_capabilities = new Map<string, ActionReplayClaim>();
let action_replay_generation = 0;

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
    action_replay_capabilities.set(entryId, {
        inverseAction,
        generation: action_replay_generation,
    });
    pruneActionReplayCapabilities();
}

export function hasActionReplayCapability(entryId: string): boolean {
    return action_replay_capabilities.has(entryId);
}

export function claimActionReplayCapability(entryId: string): ActionReplayClaim | null {
    const claim = action_replay_capabilities.get(entryId);
    if (claim === undefined) {
        return null;
    }

    action_replay_capabilities.delete(entryId);
    return claim;
}

type RestoreActionReplayCapabilityInput = {
    entryId: string;
    claim: ActionReplayClaim;
};

export function restoreActionReplayCapability({ entryId, claim }: RestoreActionReplayCapabilityInput): void {
    if (claim.generation !== action_replay_generation) {
        return;
    }

    if (action_replay_capabilities.has(entryId)) {
        return;
    }

    action_replay_capabilities.set(entryId, claim);
    pruneActionReplayCapabilities();
}

export function revokeActionReplayCapability(entryId: string): void {
    action_replay_capabilities.delete(entryId);
}

export function clearActionReplayCapabilities(): void {
    action_replay_generation += 1;
    action_replay_capabilities.clear();
}
