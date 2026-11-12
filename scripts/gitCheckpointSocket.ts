/** Select only the writer and its exact socket peer from a bounded macOS netstat snapshot. */
export function checkpointSocketRows(output: string, socket: string, pid: number): string[] | null {
    const lines = output.split('\n');
    const header = lines.find((line) => line.includes('Recv-Q') && line.includes('process:pid'));
    const writer = lines.find((line) => {
        const fields = line.trim().split(/\s+/);
        return fields[12] === `git:${pid}`;
    });
    if (!header || !writer) return null;
    const writerFields = writer.trim().split(/\s+/);
    const peer = lines.find((line) => {
        const fields = line.trim().split(/\s+/);
        return fields[0] === writerFields[5] && fields[5] === writerFields[0] && line.endsWith(` ${socket}`);
    });
    return peer ? [header, peer, writer] : null;
}
