/**
 * The whole clauses a request may state as courtesy beside a level change, and nothing else, in
 * normalized words. Read as courtesy, each asks for nothing, so it never restricts or redirects the
 * change beside it.
 */
export const STRICT_COURTESY_CLAUSES: ReadonlySet<string> = new Set(['please', 'thanks', 'thank you', 'ok', 'okay']);
