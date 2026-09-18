// Provider ids are short opaque tokens; anything else is response body.
const PROVIDER_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Both hosted protocols identify a request in the response body — OpenAI-compatible
 * `id`, Anthropic `message.id` — and the privileged gateway forwards status and
 * content type only, so a response header cannot carry this on the desktop path.
 */
export function readProviderRequestId(value: unknown): string | null {
    return typeof value === 'string' && PROVIDER_REQUEST_ID_PATTERN.test(value) ? value : null;
}
