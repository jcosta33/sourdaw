/** Optional insertion witnesses recorded by split capture and committed Undo. */
export function isClipSplitOrderSnapshot(value: unknown, clipId: string, rightClipId: string): boolean {
    return (
        value === undefined ||
        (Array.isArray(value) &&
            value.every((id) => typeof id === 'string' && id.length > 0) &&
            new Set(value).size === value.length &&
            (value.length === 0 || (value.includes(clipId) && value.indexOf(rightClipId) > value.indexOf(clipId))))
    );
}
