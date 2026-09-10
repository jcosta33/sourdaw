/**
 * Both hosted protocols identify a request in the response body — OpenAI-compatible
 * `id`, Anthropic `message.id` — and the privileged gateway forwards status and
 * content type only, so a response header cannot carry this on the desktop path.
 */
export function readProviderRequestId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
