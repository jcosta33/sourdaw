/**
 * The closed list of clauses a refinement states only as courtesy, hesitation or acknowledgement,
 * which it consumes whole. Wherever a call inherits a pending command, any other clause naming nothing
 * and stating no figure is read for what it asks, never guessed to say nothing: "slower" or "double it"
 * asks for a change the batch must answer. Only beside a batch the refinement text grounds by itself is a
 * clause of the closed courtesy list also read as asking for nothing.
 */
const FILLER_CLAUSES: ReadonlySet<string> = new Set([
    'please',
    'thanks',
    'thank you',
    'thanks a lot',
    'cheers',
    'ok',
    'okay',
    'instead',
    'go ahead',
    'actually',
    'hmm',
    'well',
    'sure',
    'yes',
    'yeah',
    'hey',
    'looks good',
    'sounds good',
    'great',
    'perfect',
    'nice',
]);

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
    'that is all',
    'that is it',
    'thank you so much',
    'thanks a bunch',
    'many thanks',
    'much appreciated',
    'appreciate it',
    'no rush',
]);

/**
 * How a refinement clause reads as filler, on every route, or as courtesy alone, beside a batch its
 * text grounds by itself: its normalized words, leading connectors read off (and, for courtesy, object
 * names masked out), are exactly one entry of the closed filler or courtesy list.
 */
export const refinementCourtesy = {
    filler: FILLER_CLAUSES,
    clauses: COURTESY_CLAUSES,
} as const;
