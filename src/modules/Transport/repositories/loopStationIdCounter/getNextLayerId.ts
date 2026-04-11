let layerId = 1;

export function getNextLayerId(): string {
    return `layer-${layerId++}`;
}