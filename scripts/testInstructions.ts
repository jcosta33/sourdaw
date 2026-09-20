/**
 * The How-to-test classifier behind the product-scope `--test` gate: whether a pull request's test
 * instructions are nothing but command narration (the checks an author or CI already ran) or teach
 * a reviewer a step they can perform in the app. `publishLane` refuses the former for a
 * product-scope change; everything here is pure text judgment with no I/O.
 */
import { fail } from './prContract.ts';

/**
 * The refusal for a product-scope publish whose `--test` is nothing but command narration. Reviewers
 * verify a product change in the app, so the section has to teach steps they can perform and the
 * result they should observe; the checks an author or CI already ran prove nothing a reviewer can see.
 */
const COMMAND_ONLY_TEST_INSTRUCTIONS_REFUSAL =
    'pull-request --test for a product-scope change must teach user/reviewer-observable steps and their ' +
    'expected result; automated author or CI check narration is not a substitute';

/**
 * The filler words that may precede or join command tokens without making a segment anything but
 * narration. One list feeds both the leading-filler pattern and the annotation vocabulary, so the
 * two can never disagree about a word.
 */
const FILLER_WORDS = [
    'run',
    'runs',
    'ran',
    'execute',
    'executes',
    'executed',
    'same',
    'for',
    'ditto',
    'then',
    'and',
    'also',
    'again',
];

/** Leading list markers a How-to-test bullet may carry: dash, asterisk, bullet, `1.`, `1)`, `a)`. */
const LEADING_LIST_MARKER = /^(?:[-*•]\s+|[0-9]+[.)]\s+|[a-z][.)]\s+)/i;

/** Filler words that precede a command without making the segment anything but narration. */
const LEADING_FILLER_WORD = new RegExp(`^(?:${FILLER_WORDS.join('|')})\\s+`, 'i');

/** Leading quoted spans (backtick, single quote, or double quote), for peeling the launch off a segment's front. */
const LEADING_QUOTED_SPAN = /^(`[^`]*`|'[^']*'|"[^"]*")/;

/** Any terminated quoted span (backtick, single quote, or double quote), for removing quoted commands from a segment's prose remainder. */
const QUOTED_SPAN = /(`[^`]*`|'[^']*'|"[^"]*")/g;

/**
 * A flat parenthetical, for stripping or keeping result annotations like `(140 passed)`. Deliberately
 * not balance-aware: nested parentheses leave the unmatched remainder in the prose, and whatever
 * survives can only fail a segment open, never shut.
 */
const PARENTHETICAL = /\([^)]*\)/g;

/** Edge punctuation a first token may trail or lead with (`vitest:`, `pnpm,`). */
const TOKEN_EDGE_PUNCTUATION = /^[,;:]+|[,;:]+$/g;

/**
 * The command heads whose mention alone reads as CI or author check narration, not an app step.
 * Exported so the specs can pin the inventory: dropping any head reddens the equality pin, a bare
 * head's behavioral iteration reddens too, and for a colon-bearing head the equality pin is the
 * only net — the path rule still classifies the dropped token.
 */
export const COMMAND_HEADS = new Set([
    'bash',
    'biome',
    'bun',
    'cargo',
    'cat',
    'cd',
    'cmake',
    'curl',
    'deno',
    'diff',
    'docker',
    'dotnet',
    'echo',
    'electron',
    'env',
    'eslint',
    'find',
    'flutter',
    'format',
    'gh',
    'git',
    'go',
    'gradle',
    'grep',
    'guard',
    'head',
    'jest',
    'less',
    'lint',
    'ls',
    'make',
    'mvn',
    'node',
    'npm',
    'npx',
    'pip',
    'pnpm',
    'playwright',
    'prettier',
    'pytest',
    'python',
    'rg',
    'rustc',
    'sh',
    'sort',
    'tail',
    'tee',
    'test:barrel-mocks',
    'test:e2e',
    'test:run',
    'deps:validate',
    'tsx',
    'tsc',
    'typecheck',
    'uv',
    'vite',
    'vitest',
    'wasm:all',
    'wasm-pack',
    'wasm:verify',
    'wc',
    'which',
    'xargs',
    'yarn',
]);

/** A trailing `.ts`-style extension: a token shaped like a filename is command material no prose rides on. */
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9]+$/;

/**
 * The closed vocabulary a command-only segment's leftover words may draw from before it stops
 * being narration: the result statuses a command line cites, and the command-annotation words
 * (the filler set plus the copula, prepositions, and scope words). Anything beyond it is real
 * instruction.
 */
const REMAINDER_VOCABULARY = new Set([
    ...FILLER_WORDS,
    'passed',
    'passes',
    'passing',
    'failed',
    'failing',
    'green',
    'clean',
    'ok',
    'okay',
    'pass',
    'fail',
    'fails',
    'skipped',
    'unchanged',
    'red',
    'reds',
    'reddens',
    'errors',
    'is',
    'it',
    'they',
    'be',
    'are',
    'was',
    'should',
    'still',
    'stays',
    'as',
    'no',
    'see',
    'ci',
    'expected',
    'both',
    'on',
    'with',
    'the',
    'a',
    'an',
    'in',
    'of',
    'to',
    'from',
    'every',
    'all',
    'each',
    'files',
    'file',
    'suite',
    'suites',
    'spec',
    'specs',
    'test',
    'tests',
    'touched',
    'changed',
    'focused',
    'modules',
    'module',
    'broad',
    'extended',
    'profile',
    'output',
    'over',
    'new',
    'old',
    'only',
    'plus',
    'via',
    'using',
]);

/**
 * Words that make a segment teach an observation rather than recite a launch: inflected stems,
 * matched at word start so `confirm` reaches `confirms`/`confirmed` and `play` reaches `plays`,
 * `played`, and `playback`. Tested in two places: the prose remainder's words, and — through the
 * material-behind check — the raw tokens a run is split into, where a cue stem stays
 * non-material. Command text is still safe: `wasm:verify` and `checkModelCached.spec.ts` carry
 * their stems inside command tokens the remainder drops before the cue test sees them.
 */
const OBSERVATION_CUE =
    /\b(?:confirm|verif|observ|check|watch|listen|hear|notice|open|click|appear|render|show|display|audible|drag|play|press|select|type|toggle|choose|create|remove|delete|move|resize|scroll|hover|arm|record|restart|start|stop|save|undo|redo|zoom|nudge|cut|copy|paste|split|duplicate|rename|edit|adjust|switch|connect|disconnect|enable|disable|import|export|load|reload|clear|reset|apply|add|set)\w*/i;

function stripRepeated(value: string, pattern: RegExp): string {
    let rest = value;
    while (pattern.test(rest)) {
        rest = rest.replace(pattern, '');
    }
    return rest;
}

/**
 * The content of a leading terminated quoted span (backtick, single quote, or double quote), or
 * the value unchanged when it has none.
 */
function leadingQuotedSpanContent(value: string): string {
    const quote = value[0];
    if (quote !== '`' && quote !== "'" && quote !== '"') {
        return value;
    }
    const closing = value.indexOf(quote, 1);
    return closing > 1 ? value.slice(1, closing) : value;
}

/**
 * The segment's first token after list markers, any leading quoted span, and every leading filler
 * word are peeled away — '' when nothing remains. Unwrapping and filler stripping alternate
 * because each can expose the other and both strictly shorten the remainder, so the loop always
 * terminates.
 */
function leadingTokenAfterPeeling(segment: string): string {
    let rest = stripRepeated(segment, LEADING_LIST_MARKER);
    for (;;) {
        const stripped = stripRepeated(leadingQuotedSpanContent(rest), LEADING_FILLER_WORD);
        if (stripped === rest) {
            return stripped.split(/\s+/)[0] ?? '';
        }
        rest = stripped;
    }
}

/**
 * The segment's prose remainder: the leading structure the token check consumes is stripped with
 * the same marker/filler/quoted-span machinery, but a leading quoted span leaves a space instead
 * of swallowing the rest — the observation a launch teaches usually lives after the span.
 */
function proseRemainder(segment: string): string {
    let rest = stripRepeated(segment, LEADING_LIST_MARKER);
    for (;;) {
        const stripped = stripRepeated(rest.replace(LEADING_QUOTED_SPAN, ' '), LEADING_FILLER_WORD);
        if (stripped === rest) {
            return stripped;
        }
        rest = stripped;
    }
}

/** Whether a token is command material no prose can ride on: heads, paths, flags, filenames. */
function isCommandToken(token: string): boolean {
    return (
        COMMAND_HEADS.has(token) ||
        /[/\\:]/.test(token) ||
        FILE_EXTENSION_SUFFIX.test(token) ||
        token.startsWith('-') ||
        isNumberOrPunctuation(token)
    );
}

/** Whether a token carries no letters at all: a bare number or punctuation. */
function isNumberOrPunctuation(token: string): boolean {
    return !/[a-z]/.test(token);
}

/**
 * Whether a parenthetical's content is pure annotation: every word in the annotation vocabulary or
 * a bare number/punctuation token. Annotation strips from the remainder; anything else — a clause
 * naming UI state — keeps its content in the prose and can rescue the segment.
 */
function isAnnotationParenthetical(parenthetical: string): boolean {
    const tokens = parenthetical
        .slice(1, -1)
        .split(/\s+/)
        .map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase());
    return tokens.every((token) => token === '' || REMAINDER_VOCABULARY.has(token) || isNumberOrPunctuation(token));
}

/**
 * Whether a raw token behind a run-ending word is material: command material or a bare prose
 * word. The cue test here reads raw tokens, so a cue-stemmed argument like `watch` in
 * `gh run watch` stays non-material; annotation vocabulary and cue words are the words the
 * narration itself is made of, so only one of them behind the run-ending word leaves it the
 * command's trailing argument.
 */
function isMaterialBehindRun(token: string): boolean {
    return token !== '' && !REMAINDER_VOCABULARY.has(token) && !OBSERVATION_CUE.test(token);
}

/**
 * The words the segment's leftover prose is made of. Quoted spans go first — backtick, single
 * quote, and double quote alike, so prose inside a command's quoted arguments cannot rescue it; a
 * parenthetical strips only when every word of its content is annotation vocabulary or a
 * number/punctuation token (`(clean)`, `(140 passed)`), while a clause naming UI state keeps its
 * content and can rescue the segment (`(the clip lands quantized to the grid)`). Then the tokens
 * drop: command heads, their subcommand slot, and their argument run — the run seeds from the
 * launch the peel exposes (a leading span's content included), not from the remainder's first
 * slot, which a leading span leaves empty, and after that leading head the token behind it is
 * command material whatever it is (`pnpm run build`, `npm start`): bare arguments drop until a
 * word a reader would actually read (vocabulary or cue) ends the run and is kept — kept only
 * when material follows it, because as the segment's last token that word is the command's
 * trailing argument and drops (`gh run watch`), as does a word followed by nothing but
 * annotation (`gh pr checks watch`) — while a head inside the run, colon-bearing or not, is
 * command material the run continues through (`pnpm exec cargo build` is launch, subcommand,
 * argument) — making quoting the launch verdict-neutral and `git fetch origin` narration all the
 * way through.
 */
function proseRemainderWords(segment: string): string[] {
    const remainder = proseRemainder(segment)
        .replaceAll(QUOTED_SPAN, ' ')
        .replace(PARENTHETICAL, (parenthetical) => (isAnnotationParenthetical(parenthetical) ? ' ' : parenthetical));
    const tokens = remainder.split(/\s+/).map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase());
    const words: string[] = [];
    // Seeded from the launch the peel exposes — a leading span's content included — not from
    // tokens[0], which a leading quoted span leaves empty.
    let insideArgumentRun = COMMAND_HEADS.has(
        leadingTokenAfterPeeling(segment).replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase()
    );
    for (const [index, word] of tokens.entries()) {
        if (word === '') {
            continue;
        }
        if (index === 0) {
            // The leading command head opens the argument run and is command material itself;
            // any other leading word is prose like any other.
            if (!insideArgumentRun && !isCommandToken(word)) {
                words.push(word);
            }
            continue;
        }
        if (insideArgumentRun && index === 1) {
            // The subcommand slot: the token behind a leading head is command material whatever
            // it is — `pnpm run build`, `npm start` — dropped before the argument run opens.
            continue;
        }
        if (insideArgumentRun) {
            // Heads inside a run are command material too: the subcommand slot handled the
            // leading launch, so a mid-run head is just another command token (`pnpm exec cargo
            // build`). Flags, paths, colon-suffixed tools, and kebab-case arguments (`show-report`
            // in `playwright show-report`) are command material whose cue-bearing halves must
            // never reach the cue test.
            if (isCommandToken(word) || word.includes('-')) {
                continue;
            }
            if (REMAINDER_VOCABULARY.has(word) || OBSERVATION_CUE.test(word)) {
                // A run-ending word rescues only when material follows it: as the segment's last
                // token — nothing but already-stripped parentheticals behind — it is the command's
                // trailing argument, and so is a word followed only by more annotation. Dropping
                // it leaves the run open for whatever little remains behind.
                if (!tokens.slice(index + 1).some(isMaterialBehindRun)) {
                    continue;
                }
                insideArgumentRun = false;
                words.push(word);
                continue;
            }
            continue;
        }
        if (!isCommandToken(word)) {
            words.push(word);
        }
    }
    return words;
}

/**
 * Whether a command head or a command-shaped token (path, flag, dotted name) sits in the peeled
 * leading position.
 */
function leadsWithCommandMaterial(segment: string): boolean {
    const lead = leadingTokenAfterPeeling(segment).replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return COMMAND_HEADS.has(lead) || isCommandToken(lead);
}

/**
 * Whether any command head appears among the segment's tokens once quoted launches are unwrapped —
 * annotation words between the filler and the launch must not hide it.
 */
function mentionsCommandHead(segment: string): boolean {
    const unwrapped = segment.replace(QUOTED_SPAN, (span) => ` ${span.slice(1, -1)} `);
    return unwrapped
        .split(/\s+/)
        .some((token) => COMMAND_HEADS.has(token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase()));
}

/**
 * Whether one segment reads as a tool invocation rather than a step a reviewer can perform. All
 * three must hold: the prose remainder (cue-bearing parentheticals included) carries no observation
 * cue, every leftover word is annotation from the closed vocabulary, and the segment is launched —
 * a command head or command-shaped token leads it, or a command head appears among its tokens. Any
 * cue or any word beyond the vocabulary is real instruction and rescues the segment.
 */
function isCommandNarration(segment: string): boolean {
    const words = proseRemainderWords(segment);
    if (words.some((word) => OBSERVATION_CUE.test(word))) {
        return false;
    }
    if (words.some((word) => !REMAINDER_VOCABULARY.has(word))) {
        return false;
    }
    return leadsWithCommandMaterial(segment) || mentionsCommandHead(segment);
}

/**
 * Segments a How-to-test value the way a reader does: per line, and per sentence or semicolon
 * clause. Only a `.` or `;` followed by whitespace or the end ends a segment, so version numbers
 * and dotted paths never split a command; empty pieces from separators and blank lines drop. List
 * markers leave the line before that split, because a numbered marker's own dot would otherwise be
 * read as a sentence boundary and strand a bare `1` segment that no command list deserves.
 * Callers guarantee non-emptiness (`composePublishBody` refuses an empty section first).
 */
function testInstructionSegments(text: string): string[] {
    const marked = text.split(/\r?\n/).map((line) => stripRepeated(line.trim(), LEADING_LIST_MARKER));
    const clauses = marked.flatMap((line) => line.split(/[.;](?:\s+|$)/));
    return clauses.map((segment) => segment.trim()).filter((segment) => segment !== '');
}

/**
 * Whether every segment of `text` narrates a command. A segment is narration only when, after the
 * command material drops out (heads, their argument runs, paths, flags, quoted spans, cue-free
 * parentheticals), its prose remainder is pure annotation: no observation cue, and no word outside
 * the annotation vocabulary. "Run `pnpm dev` and confirm the transport play button toggles" teaches
 * a step and passes; "pnpm wasm:verify" keeps its verify stem inside the dropped command token and
 * refuses. Deliberately fail-open at the margins: any prose segment — "Open the app and …", "No
 * user-visible change; …", even `None.` — makes this false.
 */
export function commandOnlyTestInstructions(text: string): boolean {
    const segments = testInstructionSegments(text);
    return segments.length > 0 && segments.every(isCommandNarration);
}

/**
 * The contract gate for a product-scope change's How-to-test section: a value that only recites
 * commands the author or CI already ran is refused, because it teaches a reviewer nothing they can
 * perform in the app. One prose sentence anywhere in the value satisfies it.
 */
export function assertObservableTestInstructions(text: string): void {
    if (commandOnlyTestInstructions(text)) {
        fail(COMMAND_ONLY_TEST_INSTRUCTIONS_REFUSAL);
    }
}
