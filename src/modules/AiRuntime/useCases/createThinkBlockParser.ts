type ThinkBlockResult = { reasoning: string | undefined; content: string };

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Incremental `<think>…</think>` parser for the streaming chat loop.
 *
 * The previous code ran a one-shot extractor on the *entire* accumulated
 * buffer for every token, making the stream O(N·L) (quadratic in the final
 * length). This parser tracks the think-block boundary across tokens and only
 * inspects the appended slice, so the whole stream is linear.
 *
 * It preserves that one-shot behavior: feeding a sequence of tokens to
 * {@link push} yields the same `{ reasoning, content }` at every step.
 */
export function createThinkBlockParser(): {
    push(token: string): ThinkBlockResult;
    snapshot(): ThinkBlockResult;
} {
    // Phases of the anchored scan:
    //   'pending'  — still deciding whether the buffer opens with `<think>`
    //                (a prefix of leading whitespace + `<think>` seen so far).
    //   'thinking' — inside an open, not-yet-closed think block.
    //   'closed'   — the think block closed; everything after is content.
    //   'plain'    — the buffer does not start with a think block; raw is content.
    let phase: 'pending' | 'thinking' | 'plain' | 'closed' = 'pending';

    // The expected anchored opener: optional leading whitespace then `<think>`.
    // We only need to remember the leading whitespace we have consumed so far.
    let leadingWhitespace = '';
    // Reasoning text accumulated while in the 'thinking' phase (raw, untrimmed).
    let reasoning = '';
    // Offset from which the next `</think>` scan starts. Everything before it has
    // already been searched, so a growing reasoning block is scanned only once
    // overall (kept back by CLOSE_TAG length so a tag split across tokens is seen).
    let closeScanFrom = 0;
    // Content accumulated after a fully-formed block (raw, untrimmed).
    let content = '';
    // For the 'plain' / 'pending' phases we keep the whole buffer so the
    // one-shot regex fallback stays exact for unusual inputs.
    let buffer = '';

    function result(): ThinkBlockResult {
        switch (phase) {
            case 'thinking':
                return { reasoning: reasoning.trim() || undefined, content: '' };
            case 'closed':
                return { reasoning: reasoning.trim() || undefined, content: content.trim() };
            case 'plain':
            case 'pending':
            default:
                // 'plain': the buffer does not open with a think block.
                // 'pending': still deciding (leading whitespace or a partial
                // opener like `<th`). In both cases the one-shot parser would
                // not yet have matched an opener, so the raw buffer is content.
                return { reasoning: undefined, content: buffer };
        }
    }

    /** Resolve the 'pending' phase as more of the buffer becomes available. */
    function resolvePending(): void {
        const trimmedStart = buffer.replace(/^\s*/, '');
        leadingWhitespace = buffer.slice(0, buffer.length - trimmedStart.length);

        if (trimmedStart.length === 0) {
            // Only whitespace so far — stay pending.
            return;
        }

        if (trimmedStart.startsWith(OPEN_TAG)) {
            // Opener complete — switch to thinking and reduce to the inner text.
            phase = 'thinking';
            reasoning = trimmedStart.slice(OPEN_TAG.length);
            scanForClose();
            return;
        }

        if (OPEN_TAG.startsWith(trimmedStart)) {
            // A strict prefix of `<think>` (e.g. `<th`) — still possibly an opener.
            return;
        }

        // The non-whitespace start is not `<think>` and cannot become it.
        phase = 'plain';
    }

    /** While 'thinking', detect a `</think>` that may straddle token boundaries. */
    function scanForClose(): void {
        const closeIdx = reasoning.indexOf(CLOSE_TAG, closeScanFrom);
        if (closeIdx === -1) {
            // Not found yet. Advance the scan window but keep CLOSE_TAG-1 chars of
            // overlap so a tag split across the next token boundary is still seen.
            closeScanFrom = Math.max(0, reasoning.length - (CLOSE_TAG.length - 1));
            return;
        }
        const after = reasoning.slice(closeIdx + CLOSE_TAG.length);
        reasoning = reasoning.slice(0, closeIdx);
        content = after.replace(/^\s*/, '');
        phase = 'closed';
        void leadingWhitespace;
    }

    return {
        push(token: string): ThinkBlockResult {
            switch (phase) {
                case 'plain':
                    buffer += token;
                    break;
                case 'closed':
                    content += token;
                    break;
                case 'thinking':
                    reasoning += token;
                    scanForClose();
                    break;
                case 'pending':
                    buffer += token;
                    resolvePending();
                    break;
            }
            return result();
        },
        snapshot(): ThinkBlockResult {
            return result();
        },
    };
}
