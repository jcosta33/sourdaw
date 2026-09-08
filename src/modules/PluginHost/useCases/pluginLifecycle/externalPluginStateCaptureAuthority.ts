const authorityByInstanceId = new Map<string, object>();

/** Stable identities for loaded-instance generations. */
export const externalPluginStateCaptureAuthority = {
    current(instanceId: string): object {
        const current = authorityByInstanceId.get(instanceId);
        if (current) {
            return current;
        }
        const created = Object.freeze({});
        authorityByInstanceId.set(instanceId, created);
        return created;
    },
    isCurrent(instanceId: string, token: object): boolean {
        return authorityByInstanceId.get(instanceId) === token;
    },
    invalidate(instanceId: string): void {
        authorityByInstanceId.delete(instanceId);
    },
    invalidateAll(): void {
        authorityByInstanceId.clear();
    },
};
