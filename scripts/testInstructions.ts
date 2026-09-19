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
export const FILLER_WORDS = [
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

/** A leading terminated backtick span, for peeling the launch off a segment's front. */
const LEADING_BACKTICK_SPAN = /^`[^`]*`/;

/** Any terminated backtick span, for removing quoted commands from a segment's prose remainder. */
const BACKTICK_SPAN = /`[^`]*`/g;

/** A balanced parenthetical, for stripping or keeping result annotations like `(140 passed)`. */
const PARENTHETICAL = /\([^)]*\)/g;

/** Edge punctuation a first token may trail or lead with (`vitest:`, `pnpm,`). */
const TOKEN_EDGE_PUNCTUATION = /^[,;:]+|[,;:]+$/g;

/**
 * The command heads whose mention alone reads as CI or author check narration, not an app step.
 * Exported so the specs can pin the inventory: dropping any head reddens the pin and its
 * behavioral fixture instead of silently un-gating a tool.
 */
export const COMMAND_HEADS = new Set([
    'bash',
    'biome',
    'bun',
    'cargo',
    'deno',
    'docker',
    'electron',
    'eslint',
    'format',
    'gh',
    'git',
    'go',
    'guard',
    'jest',
    'lint',
    'make',
    'node',
    'npm',
    'npx',
    'pnpm',
    'playwright',
    'prettier',
    'python',
    'rustc',
    'sh',
    'test:barrel-mocks',
    'test:e2e',
    'test:run',
    'deps:validate',
    'tsx',
    'tsc',
    'typecheck',
    'vitest',
    'wasm:all',
    'wasm-pack',
    'wasm:verify',
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
 * `played`, and `playback` — the old press-play phrases fold into the `play` stem. Tested against
 * the prose remainder only, never against command text: `wasm:verify` and
 * `checkModelCached.spec.ts` carry their stems inside tokens the remainder has already dropped.
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

/** The content of a leading terminated backtick span, or the value unchanged when it has none. */
function leadingBacktickSpanContent(value: string): string {
    if (!value.startsWith('`')) {
        return value;
    }
    const closing = value.indexOf('`', 1);
    return closing > 1 ? value.slice(1, closing) : value;
}

/**
 * The segment's first token after list markers, any leading backtick span, and every leading
 * filler word are peeled away — '' when nothing remains. Unwrapping and filler stripping alternate
 * because each can expose the other and both strictly shorten the remainder, so the loop always
 * terminates.
 */
function peeledLeadingToken(segment: string): string {
    let rest = stripRepeated(segment, LEADING_LIST_MARKER);
    for (;;) {
        const stripped = stripRepeated(leadingBacktickSpanContent(rest), LEADING_FILLER_WORD);
        if (stripped === rest) {
            return stripped.split(/\s+/)[0] ?? '';
        }
        rest = stripped;
    }
}

/**
 * The segment's prose remainder: the leading structure the token check consumes is stripped with
 * the same marker/filler/backtick machinery, but a leading backtick span leaves a space instead of
 * swallowing the rest — the observation a launch teaches usually lives after the span.
 */
function proseRemainder(segment: string): string {
    let rest = stripRepeated(segment, LEADING_LIST_MARKER);
    for (;;) {
        const stripped = stripRepeated(rest.replace(LEADING_BACKTICK_SPAN, ' '), LEADING_FILLER_WORD);
        if (stripped === rest) {
            return stripped;
        }
        rest = stripped;
    }
}

/** Whether a token is command material no prose can ride on: heads, paths, flags, dotted names. */
function isCommandToken(token: string): boolean {
    return (
        COMMAND_HEADS.has(token) ||
        /[/\\:]/.test(token) ||
        FILE_EXTENSION_SUFFIX.test(token) ||
        token.startsWith('-') ||
        token.startsWith('.') ||
        !/[a-z]/.test(token)
    );
}

/**
 * The words the segment's leftover prose is made of. Backtick spans go first; a parenthetical is
 * stripped only when it carries no observation cue (`(clean)` is annotation, `(confirm the …)`
 * teaches the step and its content stays). Then the tokens drop: command heads, paths, extensions,
 * flags, pure numbers and punctuation. A launch's own argument run is command material too — after
 * a leading head, bare arguments drop until a word a reader would actually read (vocabulary or
 * cue) ends the run and is kept, or the next non-colon command head ends it and is dropped — a
 * colon-bearing head is the same launch's script name, so the run continues through it — making
 * quoting the launch verdict-neutral and `git fetch origin` narration all the way through.
 */
function proseRemainderWords(segment: string): string[] {
    const remainder = proseRemainder(segment)
        .replaceAll(BACKTICK_SPAN, ' ')
        .replace(PARENTHETICAL, (parenthetical) => (OBSERVATION_CUE.test(parenthetical) ? parenthetical : ' '));
    const tokens = remainder.split(/\s+/).map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase());
    const words: string[] = [];
    let quotingArguments = tokens[0] !== undefined && COMMAND_HEADS.has(tokens[0]);
    for (const [index, word] of tokens.entries()) {
        if (word === '') {
            continue;
        }
        if (index === 0) {
            // The leading command head opens the argument run and is command material itself;
            // any other leading word is prose like any other.
            if (!quotingArguments && !isCommandToken(word)) {
                words.push(word);
            }
            continue;
        }
        if (quotingArguments) {
            if (COMMAND_HEADS.has(word) && !word.includes(':')) {
                // The next non-colon command head ends the run and drops with it — `pnpm typecheck
                // and then pnpm lint` is two launches, not a step about "typecheck". A colon
                // bearing head is the same launch's script name (`pnpm test:run …`) and the run
                // continues through it.
                quotingArguments = false;
                continue;
            }
            if (isCommandToken(word)) {
                // Flags, paths, colon-suffixed tools: command material whose stems (`check` in a
                // spec path) must never reach the cue test.
                continue;
            }
            if (REMAINDER_VOCABULARY.has(word) || OBSERVATION_CUE.test(word)) {
                quotingArguments = false;
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
 * Whether the segment is led by a launch: a command head or a command-shaped token (path, flag,
 * dotted name) in the peeled leading position, or any command head among the segment's tokens once
 * quoted launches are unwrapped — annotation words between the filler and the launch must not
 * hide it.
 */
function segmentIsCommandLed(segment: string): boolean {
    const lead = peeledLeadingToken(segment).replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    if (COMMAND_HEADS.has(lead) || isCommandToken(lead)) {
        return true;
    }
    const unwrapped = segment.replace(BACKTICK_SPAN, (span) => ` ${span.slice(1, -1)} `);
    return unwrapped
        .split(/\s+/)
        .some((token) => COMMAND_HEADS.has(token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase()));
}

/**
 * Whether one segment reads as a tool invocation rather than a step a reviewer can perform. All
 * three must hold: the prose remainder (cue-bearing parentheticals included) carries no observation
 * cue, every leftover word is annotation from the closed vocabulary, and the segment is
 * command-led — any cue or any word beyond the vocabulary is real instruction and rescues the
 * segment.
 */
function isCommandNarration(segment: string): boolean {
    const words = proseRemainderWords(segment);
    if (words.some((word) => OBSERVATION_CUE.test(word))) {
        return false;
    }
    if (words.some((word) => !REMAINDER_VOCABULARY.has(word))) {
        return false;
    }
    return segmentIsCommandLed(segment);
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
