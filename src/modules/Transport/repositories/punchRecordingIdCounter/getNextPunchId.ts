let punchId = 1;

export function getNextPunchId(): string {
    return `punch-${punchId++}`;
}