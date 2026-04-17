export function getNextPunchId(): string {
    return `punch-${crypto.randomUUID()}`;
}