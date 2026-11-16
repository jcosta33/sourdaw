/** A printed figure followed by its unit, which a ratio, count or correlation does not name. */
export function withVibeUnit(shown: string, unit: string | null): string {
    if (unit === null || unit === 'ratio' || unit === 'count' || unit === 'correlation') {
        return shown;
    }
    return `${shown} ${unit === 'hertz' ? 'Hz' : unit}`;
}
