export function requireCheckpointIdentity(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`[CheckpointPersistence] ${name} must be a non-empty string`);
    }
    return value;
}
