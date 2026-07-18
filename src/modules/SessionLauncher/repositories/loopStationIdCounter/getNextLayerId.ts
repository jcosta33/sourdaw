export function getNextLayerId(): string {
    return `layer-${crypto.randomUUID()}`;
}
