/**
 * The phrases that close a request without naming an object or narrowing what it asks, in normalized
 * words: where the change is heard ("in the mix", "overall"), who asks it ("for me") and when ("now").
 * A clause closing on one still names only the object and the amount it named. A conditional close
 * ("if you can") is no entry: the unsafe control cue refuses any `if` first.
 */
export const CLOSING_PHRASES: readonly string[] = ['in the mix', 'overall', 'for me', 'now'];
