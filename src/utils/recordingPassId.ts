/** Optional persisted recording identities have one admission law at every owner. */
export function isRecordingPassId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim();
}
