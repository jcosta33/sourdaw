export function makeKey(trackId: string, parameterId: string): string {
    return `${trackId}::${parameterId}`;
}
