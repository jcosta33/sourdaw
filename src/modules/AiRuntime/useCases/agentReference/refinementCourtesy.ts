/**
 * The closed list of whole clauses a refinement may state as courtesy alone, beyond the filler every
 * route consumes, in normalized words ("that's" reads "that s"): a greeting, an apology, an
 * acknowledgement, thanks, or a hedge on the request itself. The list is closed, never read by the
 * words a clause happens to lack: a clause outside it ("no wait", "actually no", "oops", "forget that",
 * "scratch that", "just kidding", "twice", "slightly", "half") may withdraw or qualify the change
 * beside it, so it asks for something rather than nothing.
 */
const COURTESY_CLAUSES: ReadonlySet<string> = new Set([
    'hi',
    'hello',
    'hi there',
    'sorry',
    'alright',
    'cool',
    'yes please',
    'pls',
    'thank you very much',
    'thanks so much',
    'thx',
    'if possible',
    'if you can',
    'that should be better',
    'that s better',
    'that s all',
    'that s it',
]);

/**
 * How a refinement clause reads as courtesy alone, beside a batch its text grounds by itself: its
 * normalized words, object names masked out and leading connectors read off, are exactly one entry of
 * the closed courtesy list.
 */
export const refinementCourtesy = {
    clauses: COURTESY_CLAUSES,
} as const;
