/** Find mount options only for the filesystem device reported by df. */
export function checkpointMountOptions(df: string | null, mounts: string | null): string | null {
    if (!df || !mounts) {
        return null;
    }
    const lines = df.split('\n');
    const device = lines[1]?.trim().split(/\s+/)[0];
    if (!device) {
        return null;
    }
    return mounts.split('\n').find((line) => line.startsWith(`${device} on `)) ?? null;
}
