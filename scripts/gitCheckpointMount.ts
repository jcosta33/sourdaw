/** Find mount options only for the exact filesystem and mountpoint reported by df. */
export function checkpointMountOptions(df: string | null, mounts: string | null): string | null {
    if (!df || !mounts) {
        return null;
    }
    const lines = df.split('\n');
    const row = lines[1]?.match(/^(\S+)\s+\d+\s+\d+\s+\d+\s+\d+%\s+(.+?)\s*$/);
    if (!row) {
        return null;
    }
    const prefix = `${row[1]} on ${row[2]} (`;
    return mounts.split('\n').find((line) => line.startsWith(prefix)) ?? null;
}
