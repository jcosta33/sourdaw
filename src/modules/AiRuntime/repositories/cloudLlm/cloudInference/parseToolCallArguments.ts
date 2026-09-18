function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Advertised arguments arrive as a JSON string on both OpenAI protocols; anything
 * that is not an object once parsed is not a usable call.
 */
export function parseToolCallArguments(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}
