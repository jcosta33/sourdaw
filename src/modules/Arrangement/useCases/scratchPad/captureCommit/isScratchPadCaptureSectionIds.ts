/** Whether a capture's supplied pad section ids can name pad sections: unique, non-empty strings. */
export function isScratchPadCaptureSectionIds(value: unknown): value is readonly string[] {
    if (!Array.isArray(value)) {
        return false;
    }
    const ids: readonly unknown[] = value;
    if (!ids.every((id) => typeof id === 'string' && id.length > 0)) {
        return false;
    }
    return new Set(ids).size === ids.length;
}
