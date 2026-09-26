/**
 * The How-to-test classifier behind the product-scope `--test` gate: whether a pull request's test
 * instructions narrate checks (commands an author or CI already ran, or the test suite that covers
 * the change) instead of teaching only steps a reviewer performs in the app. `publishLane` refuses
 * the former for a product-scope change; everything here is pure text judgment with no I/O.
 */
import { fail, PULL_REQUEST_BODY_BYTE_LIMIT } from './prContract.ts';

/**
 * The refusal for a product-scope publish whose `--test` narrates checks anywhere. Reviewers verify
 * a product change in the app, so the section has to teach steps they can perform and the result
 * they should observe; the checks an author or CI already ran prove nothing a reviewer can see, and
 * a list of them beside the steps is padding a reader has to skip.
 * Exported so the specs can pin against the literal without owning a copy: rewording it reddens every
 * refusal pin in one place, exactly like the head inventory's export-for-pin treatment.
 */
export const CHECK_NARRATION_TEST_INSTRUCTIONS_REFUSAL =
    'pull-request --test for a product-scope change must teach only user/reviewer-observable steps and ' +
    'their expected result; drop every line that narrates a command, spec, or CI check, and fold an app ' +
    'launch into the step that uses it';

/** How many judged segments a refusal quotes before it counts the rest. */
const QUOTED_SEGMENT_LIMIT = 3;

/** The length, in characters, past which a quoted segment is cut and marked with an ellipsis. */
const QUOTED_SEGMENT_MAX_CHARACTERS = 120;

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

/**
 * Articles whose presence directly behind a peeled command head keeps the argument run closed:
 * `Make a MIDI track` and `Format the clip name` are the step's own verb naming its object, not a
 * launch opening an argument run that would eat the UI nouns. A bare argument (`make test`) is
 * still the launch it reads as.
 */
const LEADING_ARTICLES = new Set(['a', 'an', 'the']);

/** Filler words that precede a command without making the segment anything but narration. */
const LEADING_FILLER_WORD = new RegExp(`^(?:${FILLER_WORDS.join('|')})\\s+`, 'i');

/**
 * A letter or digit. An apostrophe with one immediately on both sides (`track's`, `doesn't`) is
 * part of the word and never opens or closes a single-quoted span. The sentence split
 * (`isInWordApostrophe`) and both quoted-span patterns read it the same way, so a possessive can
 * neither hold the rest of its line open against the split nor pair with a later contraction into
 * a span that hides the prose between them. An apostrophe with whitespace, punctuation, or the line
 * edge on either side still delimits: `python -c 'import json; print(1)'` stays one quoted argument.
 */
const WORD_CHARACTER = '[\\p{L}\\p{N}]';

/** An apostrophe inside a word, as a pattern fragment. */
const IN_WORD_APOSTROPHE = `(?<=${WORD_CHARACTER})'(?=${WORD_CHARACTER})`;

/** A terminated single-quoted span: delimiting apostrophes outside any word, in-word apostrophes allowed inside. */
const SINGLE_QUOTED_SPAN = `(?!${IN_WORD_APOSTROPHE})'(?:[^']|${IN_WORD_APOSTROPHE})*(?!${IN_WORD_APOSTROPHE})'`;

/** One code point that is a letter or digit, for the sentence split's per-character apostrophe test. */
const WORD_CHARACTER_ONLY = new RegExp(`^${WORD_CHARACTER}$`, 'u');

/** Leading quoted spans (backtick, single quote, or double quote), for peeling the launch off a segment's front. */
const LEADING_QUOTED_SPAN = new RegExp(`^(\`[^\`]*\`|${SINGLE_QUOTED_SPAN}|"[^"]*")`, 'u');

/** Any terminated quoted span (backtick, single quote, or double quote), for removing quoted commands from a segment's prose remainder. */
const QUOTED_SPAN = new RegExp(`(\`[^\`]*\`|${SINGLE_QUOTED_SPAN}|"[^"]*")`, 'gu');

/**
 * A flat parenthetical, for stripping or keeping result annotations like `(140 passed)`. A match
 * never spans another open parenthesis, so an unclosed `(` costs one scan to the next `(` rather
 * than one to the end of the value, keeping the scan linear. Deliberately not balance-aware: in a
 * nested group the innermost pair matches first, the outer remainder stays in the prose, and
 * whatever survives can only fail a segment open, never shut.
 */
const PARENTHETICAL = /\([^()]*\)/g;

/**
 * Edge punctuation a first token may trail or lead with (`vitest:`, `pnpm,`). Parentheses ride
 * along so a kept parenthetical's edge words classify bare — `(the` must reach the annotation
 * vocabulary and `(confirm` the cue test exactly as their unpunctuated spellings would.
 */
const TOKEN_EDGE_PUNCTUATION = /^[,;:()]+|[,;:()]+$/g;

/**
 * A `NAME=value` token: an environment assignment prefix is command material, never the leading
 * prose word that rescues a launch behind it (`SOURDAW_E2E_PORT=4010 pnpm test:e2e …`).
 */
const ENV_ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;

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
    'electron-builder',
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
    'knip',
    'less',
    'lint',
    'ls',
    'make',
    'mvn',
    'node',
    'npm',
    'npx',
    'oxlint',
    'pip',
    'pnpm',
    'playwright',
    'prettier',
    'pytest',
    'python',
    'python3',
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
    'wasm-bindgen',
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
 * The observation-cue stems, in one list so the cue regex and the bare-stem test behind the
 * material check can never disagree: inflected stems, matched at word start so `confirm` reaches
 * `confirms`/`confirmed` and `play` reaches `plays`, `played`, and `playback`. Tested in two
 * places: the prose remainder's words, and — through the material-behind check — the raw tokens a
 * run is split into, where a bare cue stem stays non-material. Command text is still safe:
 * `wasm:verify` and `checkModelCached.spec.ts` carry their stems inside command tokens the
 * remainder drops before the cue test sees them.
 */
const OBSERVATION_CUE_STEMS = [
    'confirm',
    'verif',
    'observ',
    'check',
    'watch',
    'listen',
    'hear',
    'notice',
    'open',
    'click',
    'appear',
    'render',
    'show',
    'display',
    'audible',
    'drag',
    'play',
    'press',
    'select',
    'type',
    'toggle',
    'choose',
    'create',
    'remove',
    'delete',
    'move',
    'resize',
    'scroll',
    'hover',
    'arm',
    'record',
    'restart',
    'start',
    'stop',
    'save',
    'undo',
    'redo',
    'zoom',
    'nudge',
    'cut',
    'copy',
    'paste',
    'split',
    'duplicate',
    'rename',
    'edit',
    'adjust',
    'switch',
    'connect',
    'disconnect',
    'enable',
    'disable',
    'import',
    'export',
    'load',
    'reload',
    'clear',
    'reset',
    'apply',
    'add',
    'set',
];

const OBSERVATION_CUE = new RegExp(`\\b(?:${OBSERVATION_CUE_STEMS.join('|')})\\w*`, 'i');

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
    const span = leadingQuotedSpan(value);
    return span.length > 2 ? span.slice(1, -1) : value;
}

/** The leading terminated quoted span itself, quotes included, or empty when the value has none. */
function leadingQuotedSpan(value: string): string {
    return LEADING_QUOTED_SPAN.exec(value)?.[0] ?? '';
}

type PeeledLaunch = { lead: string; follower: string; spanLead: boolean; spanTokens: number };

/**
 * The launch a segment's peel exposes, with what the argument-run scan needs around it: the head
 * token, the token that follows it (the determiner probe), and the quoted-span facts. The peel is
 * an unwrap-and-strip alternation — list markers first, then a leading quoted span unwrapped to
 * its content and leading filler words stripped, each exposing the other, both strictly shortening
 * the remainder. A leading span marks the launch quoted and reports how many tokens its content
 * held: more than the head alone means the span already consumed the head's subcommand slot inside
 * the quotes; the head alone leaves the slot behind the span, so the determiner probe consults the
 * first token behind a head-only span — '`make` a MIDI track' reads its article exactly where the
 * bare spelling does, while a bare argument behind the span ('`make` test') still opens the run.
 */
function peeledLaunch(segment: string): PeeledLaunch {
    let rest = stripRepeated(segment, LEADING_LIST_MARKER);
    let spanLead = false;
    let spanTokens = 0;
    let spanFollower = '';
    for (;;) {
        const quote = rest[0];
        if (quote === '`' || quote === "'" || quote === '"') {
            const span = leadingQuotedSpan(rest);
            const content = leadingQuotedSpanContent(rest).trim();
            spanLead = true;
            spanTokens = content === '' ? 0 : content.split(/\s+/).length;
            if (spanTokens === 1 && span.length > 2) {
                const behind = rest.slice(span.length).trim();
                spanFollower = behind === '' ? '' : (behind.split(/\s+/)[0] ?? '');
            }
        }
        const stripped = stripRepeated(leadingQuotedSpanContent(rest), LEADING_FILLER_WORD);
        if (stripped === rest) {
            const tokens = rest.split(/\s+/);
            return {
                lead: tokens[0] ?? '',
                follower: spanLead && spanTokens === 1 ? spanFollower : (tokens[1] ?? ''),
                spanLead,
                spanTokens,
            };
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

/** Whether a token is command material no prose can ride on: heads, paths, flags, filenames, env assignments. */
function isCommandToken(token: string): boolean {
    return COMMAND_HEADS.has(token) || isCommandShapedToken(token) || isNumberOrPunctuation(token);
}

/** Whether a token has a command's shape whatever its words: a path, a colon suffix, a filename, a flag, or an env assignment. */
function isCommandShapedToken(token: string): boolean {
    return (
        /[/\\:]/.test(token) ||
        FILE_EXTENSION_SUFFIX.test(token) ||
        token.startsWith('-') ||
        ENV_ASSIGNMENT_TOKEN.test(token)
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
 * word. The cue test here reads raw tokens, so a bare cue stem — the narration's own word, the
 * command's trailing argument (`watch` in `gh run watch`) — stays non-material, while an
 * inflected form is a real word of the observation (`playback`, `starts`) and counts as the
 * material a rescuing word needs behind it. Annotation vocabulary stays non-material before the
 * cue test runs. In the strict mode a run entered through command machinery demands, a bare
 * non-cue word is the command's own argument (`x` in `pnpm dlx vitest run x`), not the
 * observation a rescuing word needs behind it — only a real inflected cue word counts there.
 */
function isMaterialBehindRun(token: string, strict: boolean): boolean {
    if (token === '' || REMAINDER_VOCABULARY.has(token)) {
        return false;
    }
    if (OBSERVATION_CUE_STEMS.includes(token)) {
        return false;
    }
    if (!OBSERVATION_CUE.test(token)) {
        return !strict;
    }
    return true;
}

/**
 * Whether the peel's lead opens the segment's argument run: a command head or an env assignment
 * leads it (`SOURDAW_E2E_PORT=4010 pnpm test:e2e …`), while an article directly behind the head
 * keeps the run closed — `Make a MIDI track` is the step's own verb naming its object, not a
 * launch — and so does an English-word lead.
 */
function opensArgumentRun(launch: PeeledLaunch, segment: string): boolean {
    if (isEnglishWordLead(launch, segment)) {
        return false;
    }
    const lead = launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    const follower = launch.follower.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return (COMMAND_HEADS.has(lead) || ENV_ASSIGNMENT_TOKEN.test(lead)) && !LEADING_ARTICLES.has(follower);
}

/**
 * The command heads that are also ordinary English imperative verbs a DAW step can open with
 * (`Go to Settings`, `sort by name`, `make track 2 mono`). Heads whose English use is itself check
 * narration (`lint`, `typecheck`, the colon-bearing scripts) and tool names stay out, so they open
 * an argument run whatever their letter case.
 */
const STEP_VERB_HEADS = ['diff', 'echo', 'find', 'format', 'go', 'head', 'less', 'make', 'sort', 'tail'];

/**
 * The command heads that are also ordinary English words a DAW step or its expected result can
 * carry: the step verbs, plus the nouns and pronouns a result sentence names (`Node 2 is gone`,
 * `the cat`, `which track`). Their mere presence is no command evidence; only a quoted spelling or
 * a command-shaped token beside them shows the segment is a command line. Tool names (`pnpm`,
 * `git`, `cargo`) stay out, so their presence alone keeps reading as a launch.
 */
const ENGLISH_WORD_HEADS = new Set([...STEP_VERB_HEADS, 'node', 'env', 'which', 'electron', 'guard', 'tee', 'cat']);

/**
 * Whether the peeled lead is an English word rather than a launch: an unquoted member of
 * `ENGLISH_WORD_HEADS`, in any letter case and wherever the peel exposes it (behind a stripped
 * filler word, at the start of a `;` or `.` clause), in a segment carrying no command-shaped token.
 * The word class decides, never the casing: a sentence may open lower-case (`Then go to bar 9`) and
 * a tool line may be capitalized (`Pnpm dev`, `Cargo build succeeds`), so a tool head opens its
 * argument run exactly as its lower-case spelling does. A flag, path, colon suffix, filename, or env
 * assignment beside the head shows the segment is a command line after all (`go test ./...`); a
 * quoted head was typed as a command, so it stays a launch. The head itself still drops from the
 * prose, so an English-word lead followed only by annotation (`make test`) keeps narrating through
 * `leadsWithCommandMaterial` unless an article shows it naming its object (`Find the new file`).
 */
function isEnglishWordLead(launch: PeeledLaunch, segment: string): boolean {
    if (launch.spanLead || !ENGLISH_WORD_HEADS.has(launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase())) {
        return false;
    }
    return !carriesCommandShapedToken(segment);
}

/**
 * Whether any token of the segment has a command's shape (path, colon suffix, filename, flag, env
 * assignment). Letter-free tokens (`bar 9`, `-6`, `1.5`) never count: they are the positions and
 * values a step names, not a command line's evidence.
 */
function carriesCommandShapedToken(segment: string): boolean {
    return unwrappedTokens(segment).some((token) => !isNumberOrPunctuation(token) && isCommandShapedToken(token));
}

/**
 * Whether what follows a run-ending word lets it close the argument run and rescue the segment.
 * Command material directly behind the word is the command itself continuing — the `run` of
 * `ast-grep run --lang ts -p …` — so the word stays the run's argument and the run stays open.
 * Otherwise real material must follow: as the segment's last token the word is the command's
 * trailing argument (`gh run watch`), and a word followed by nothing but annotation
 * (`gh pr checks watch`) drops with it. In the strict mode, armed for runs entered through
 * command machinery, only an inflected cue word is that material — the bare word behind the
 * article of `pnpm test:run the transport spec` or behind the `run` that follows the `vitest`
 * head stays the command's argument.
 */
function closesArgumentRun(behind: string[], strict: boolean): boolean {
    const next = behind.find((token) => token !== '');
    if (next !== undefined && isCommandToken(next)) {
        return false;
    }
    return behind.some((token) => isMaterialBehindRun(token, strict));
}

/**
 * Whether the argument run closes at this run-ending vocabulary-or-cue word. A cue word is the
 * observation's own verb, so it always closes on any material behind it; a non-cue vocabulary
 * word closes strictly where the run was launched by command machinery — a subcommand slot that
 * carried command material, or a head dropped inside the run — where only an inflected cue word
 * is the material a rescuing word needs.
 */
function closesAtRunEndingWord(
    word: string,
    behind: string[],
    slotWasCommandMaterial: boolean,
    behindWasHead: boolean
): boolean {
    return closesArgumentRun(behind, (slotWasCommandMaterial || behindWasHead) && !OBSERVATION_CUE.test(word));
}

/**
 * The words the segment's leftover prose is made of. Quoted spans go first — backtick, single
 * quote, and double quote alike, so prose inside a command's quoted arguments cannot rescue it; a
 * parenthetical strips only when every word of its content is annotation vocabulary or a
 * number/punctuation token (`(clean)`, `(140 passed)`), while a clause naming UI state keeps its
 * content and can rescue the segment (`(the clip lands quantized to the grid)`). Then the tokens
 * drop: command heads, their subcommand slot, and their argument run — the run seeds from the
 * launch the peel exposes (a leading span's content included), not from the remainder's first
 * slot, which a leading span leaves empty. The subcommand slot is the single token immediately
 * behind the head: a bare head keeps it at the remainder's second token (`pnpm run build`,
 * `npm start`), a quoted span consumed it inside the quotes unless the span held nothing but the
 * head (a span holding only 'pnpm' leaves 'run build' refusing like the bare spelling), and an
 * article behind the head keeps the run closed entirely — `Make a MIDI track` is the step's own
 * verb naming its object, not a launch. Behind the slot, bare arguments drop until a word a
 * reader would actually read (vocabulary or cue) ends the run and is kept only when
 * closesArgumentRun lets it, while a head inside the run, colon-bearing or not, is command
 * material the run continues through (`pnpm exec cargo build` is launch, subcommand, argument) —
 * making quoting the launch verdict-neutral and `git fetch origin` narration all the way through.
 * When that machinery launched the run — a subcommand slot that carried command material, or a
 * head dropped inside it — the run-ending vocabulary word closes strictly: the bare noun behind
 * it is the command's own argument (`the transport spec` after `pnpm test:run`), where a launch
 * through a bare subcommand or prose slot keeps closing on it (`the mixer` after `go to`).
 */
function proseRemainderWords(segment: string): string[] {
    const remainder = proseRemainder(segment)
        .replaceAll(QUOTED_SPAN, ' ')
        .replace(PARENTHETICAL, (parenthetical) => (isAnnotationParenthetical(parenthetical) ? ' ' : parenthetical));
    const tokens = remainder.split(/\s+/).map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase());
    const words: string[] = [];
    // Seeded from the launch the peel exposes — a leading span's content included — not from
    // tokens[0], which a leading quoted span leaves empty.
    const launch = peeledLaunch(segment);
    let insideArgumentRun = opensArgumentRun(launch, segment);
    let slotBehindSpan = insideArgumentRun && launch.spanLead && launch.spanTokens === 1;
    // The strict material mode arms when the run's launch is command machinery: the head's
    // subcommand slot carried command material, or a command head was dropped inside the run. A
    // bare non-cue word behind a run-ending word is then that command's own argument — never the
    // observation a rescuing word needs behind it — while a launch through a bare subcommand or
    // prose slot (`pnpm dev and drag a clip onto a lane`, `go to the mixer`) keeps the loose rule.
    let slotWasCommandMaterial = false;
    let behindWasHead = false;
    for (const [index, word] of tokens.entries()) {
        if (word === '') {
            continue;
        }
        if (slotBehindSpan) {
            // The head's subcommand slot, pushed behind a head-only quoted span: command
            // material whatever it is, dropped before the argument run opens.
            slotBehindSpan = false;
            slotWasCommandMaterial = true;
            continue;
        }
        if (index === 0 && !launch.spanLead) {
            // The leading command head opens the argument run and is command material itself;
            // any other leading word is prose like any other. A quoted launch has no head here —
            // its span took it — so the word behind it scans like any in-run argument.
            if (!insideArgumentRun && !isCommandToken(word)) {
                words.push(word);
            }
            continue;
        }
        if (insideArgumentRun && !launch.spanLead && index === 1) {
            // The subcommand slot: the token behind a bare leading head is command material
            // whatever it is — `pnpm run build`, `npm start` — dropped before the argument run
            // opens. A quoted launch has no token here: its span already held the head, so the
            // words behind it are arguments, never the slot.
            slotWasCommandMaterial = isCommandToken(word);
            continue;
        }
        if (insideArgumentRun) {
            // Heads inside a run are command material too: the subcommand slot handled the
            // leading launch, so a mid-run head is just another command token (`pnpm exec cargo
            // build`). Flags, paths, colon-suffixed tools, and kebab-case arguments (`show-report`
            // in `playwright show-report`) are command material whose cue-bearing halves must
            // never reach the cue test.
            if (isCommandToken(word) || word.includes('-')) {
                behindWasHead = COMMAND_HEADS.has(word);
                continue;
            }
            if (REMAINDER_VOCABULARY.has(word) || OBSERVATION_CUE.test(word)) {
                if (closesAtRunEndingWord(word, tokens.slice(index + 1), slotWasCommandMaterial, behindWasHead)) {
                    insideArgumentRun = false;
                    words.push(word);
                }
                behindWasHead = false;
                continue;
            }
            behindWasHead = false;
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
 * leading position. An English-word lead counts unless an article directly behind it shows the
 * step naming its object: `make test` is the launch it reads as, `Find the new file` is a step.
 */
function leadsWithCommandMaterial(segment: string): boolean {
    const launch = peeledLaunch(segment);
    if (isEnglishWordLead(launch, segment)) {
        return !LEADING_ARTICLES.has(launch.follower.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase());
    }
    const lead = launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return COMMAND_HEADS.has(lead) || isCommandToken(lead);
}

/**
 * Whether any command head appears among the segment's tokens once quoted launches are unwrapped —
 * annotation words between the filler and the launch must not hide it. A tool head counts by
 * presence; an English-word head (`The tail is unchanged`) counts only where it was quoted or the
 * segment carries a command-shaped token.
 */
function mentionsCommandHead(segment: string): boolean {
    const quoted = quotedTokens(segment);
    const commandShaped = carriesCommandShapedToken(segment);
    return unwrappedTokens(segment).some(
        (token) => COMMAND_HEADS.has(token) && (!ENGLISH_WORD_HEADS.has(token) || commandShaped || quoted.has(token))
    );
}

/** The lower-cased tokens written inside the segment's quoted spans. */
function quotedTokens(segment: string): Set<string> {
    const spans = segment.match(QUOTED_SPAN) ?? [];
    return new Set(spans.flatMap((span) => unwrappedTokens(span.slice(1, -1))));
}

/** The segment's lower-cased tokens with quoted spans unwrapped and edge punctuation stripped. */
function unwrappedTokens(segment: string): string[] {
    return spelledTokens(segment).map((token) => token.toLowerCase());
}

/** The segment's tokens in their written letter case, quoted spans unwrapped and edge punctuation stripped. */
function spelledTokens(segment: string): string[] {
    const unwrapped = segment.replace(QUOTED_SPAN, (span) => ` ${span.slice(1, -1)} `);
    return unwrapped.split(/\s+/).map((token) => token.replace(TOKEN_EDGE_PUNCTUATION, ''));
}

/**
 * Whether one segment reads as a tool invocation rather than a step a reviewer can perform. All
 * three must hold: the prose remainder (cue-bearing parentheticals included) carries no observation
 * cue, every leftover word is annotation from the closed vocabulary, and the segment is launched —
 * a command head or command-shaped token leads it, or a command head appears among its tokens. Any
 * cue or any word beyond the vocabulary is real instruction and rescues the segment. A segment with
 * no letters names no command: it is the stranded marker of an inline numbered list (`2` from
 * `1. Press Play. 2. Press Stop`), whose own dot the sentence split reads as a boundary.
 */
function isCommandNarration(segment: string): boolean {
    if (!/[a-z]/i.test(segment)) {
        return false;
    }
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
 * clause. Only a `.` or `;` followed by whitespace or the end ends a segment, and only outside a
 * quoted span — backtick, single quote, and double quote alike — so version numbers, dotted
 * paths, and a separator inside a command's quoted argument (`python -c "import json; print(1)"`)
 * never split a command into a launch-less fragment. An apostrophe with a letter or digit on both
 * sides (`the track's fader`, `doesn't`) is part of its word and opens no span, so a possessive
 * never merges the sentences behind it into one segment; empty pieces from separators and blank lines
 * drop. List markers leave the line before that split, because a numbered marker's own dot would
 * otherwise be read as a sentence boundary and strand a bare `1` segment that no command list
 * deserves. Empty input yields no segment and so narrates nothing; `composePublishBody`'s emptiness
 * refusal runs after the gate.
 */
function testInstructionSegments(text: string): string[] {
    const marked = text.split(/\r?\n/).map((line) => stripRepeated(line.trim(), LEADING_LIST_MARKER));
    const clauses = marked.flatMap(splitOutsideQuotedSpans);
    return clauses.map((segment) => segment.trim()).filter((segment) => segment !== '');
}

/**
 * One line split on `.`/`;` followed by whitespace or the end, but only while no quoted span is
 * open. The quote kind that opens a span is the only kind that closes it, so an apostrophe inside
 * a double-quoted message never ends it, and an in-word apostrophe neither opens nor closes one;
 * the separator itself drops, every other character (opening and closing quotes included) stays
 * for the launch peel and the quoted-span removal downstream.
 */
function splitOutsideQuotedSpans(line: string): string[] {
    const characters = [...line];
    const segments: string[] = [];
    let current = '';
    let quote: string | undefined;
    for (const [index, character] of characters.entries()) {
        const delimits = !isInWordApostrophe(characters, index);
        if (quote === undefined && delimits && (character === '`' || character === "'" || character === '"')) {
            quote = character;
        } else if (character === quote && delimits) {
            quote = undefined;
        }
        if (quote === undefined && (character === '.' || character === ';')) {
            const next = characters[index + 1];
            if (next === undefined || /\s/.test(next)) {
                segments.push(current);
                current = '';
                continue;
            }
        }
        current += character;
    }
    segments.push(current);
    return segments;
}

/** Whether the code point at `index` is an apostrophe with a letter or digit immediately on both sides. */
function isInWordApostrophe(characters: readonly string[], index: number): boolean {
    return (
        characters[index] === "'" &&
        WORD_CHARACTER_ONLY.test(characters[index - 1] ?? '') &&
        WORD_CHARACTER_ONLY.test(characters[index + 1] ?? '')
    );
}

/**
 * Test-suite vocabulary no reviewer step in the app ever needs: spec files and the suites that hold
 * them. A segment naming any of them is describing coverage — "the census spec fails if …",
 * "run the focused publisher specs" — whatever prose surrounds it. `specs?` also covers every
 * `x.spec.ts` filename, because the dots around it are word boundaries. A bare `test` stays out:
 * a test tone or a test take is something a reviewer plays or records, so only the plural (`Covered
 * by tests`) or a qualified suite (`unit suite`, `the test suite`) names coverage.
 */
const TEST_SUITE_WORDS =
    /\b(?:specs?|e2e|tests|test suites?|(?:unit|integration|end-to-end|existing)[- ](?:tests?|suites?))\b|__tests__\//i;

/**
 * The repository's test runners, named as proper nouns. Matched case-sensitively: prose capitalizes a runner's
 * name (`Covered by Playwright`), while the lower-case spelling is the command a launch types
 * (`pnpm exec playwright open the app …`), which the narration rule judges instead.
 */
const TEST_RUNNER_NAMES = /\b(?:Vitest|Playwright)\b/;

/** `CI`, matched case-sensitively so a lower-case `ci` token and the letters inside words stay out. */
const CI_WORD = /\bCI\b/;

function namesTestSuite(segment: string): boolean {
    return TEST_SUITE_WORDS.test(segment) || TEST_RUNNER_NAMES.test(segment) || CI_WORD.test(segment);
}

/** Script families every member of which runs a check: `test:run`, `typecheck:scripts`, `lint:fix`, `cargo:test`. */
const CHECK_SCRIPT_FAMILIES = new Set(['test', 'typecheck', 'lint', 'cargo']);

/** Check scripts and tools that run nothing but a check: a reviewer never launches one to use the app. */
const CHECK_COMMANDS = new Set([
    'deps:validate',
    'wasm:verify',
    'typecheck',
    'lint',
    'tsc',
    'eslint',
    'prettier',
    'oxlint',
    'biome',
    'knip',
    'jest',
    'pytest',
    'vitest',
]);

/**
 * Heads whose `test` subcommand runs a suite (`pnpm test`, `cargo test`, `go test`). Playwright rides
 * here rather than among the check-only commands: `playwright open` is a browser a reviewer drives,
 * and only `playwright test` runs the suite.
 */
const TEST_SUBCOMMAND_HEADS = new Set(['pnpm', 'npm', 'yarn', 'bun', 'cargo', 'go', 'make', 'playwright']);

/**
 * Whether the segment mentions a check command, whatever prose rides beside it: a check-family
 * colon script, a check-only script or tool, or a head running its `test` subcommand. The command
 * rule lets a cue word or a UI noun rescue a launch, which is right for `pnpm dev` and wrong for a
 * check run — no step a reviewer performs needs one. Matched in the written lower-case spelling
 * only, so a capitalized English word opening a sentence (`Go test the limiter`, `Prettier
 * waveforms`) stays prose; bare `test`, `format`, and launch scripts (`desktop:dev`) never match.
 */
function mentionsCheckCommand(segment: string): boolean {
    const tokens = spelledTokens(segment);
    return tokens.some(
        (token, index) =>
            CHECK_COMMANDS.has(token) ||
            isCheckFamilyScript(token) ||
            (TEST_SUBCOMMAND_HEADS.has(token) && tokens[index + 1] === 'test')
    );
}

/** Whether a token is a colon script of a check family: `test:e2e`, `typecheck:scripts`, `cargo:fmt`. */
function isCheckFamilyScript(token: string): boolean {
    const colon = token.indexOf(':');
    return colon > 0 && CHECK_SCRIPT_FAMILIES.has(token.slice(0, colon));
}

/**
 * The segments of `text` that narrate a check: each reads as a command invocation once its command
 * material drops out (heads, their argument runs, paths, flags, quoted spans, cue-free
 * parentheticals, leaving no observation cue and no word outside the annotation vocabulary), names
 * the test suite, or mentions a check command at all. "Run `pnpm dev` and confirm the transport
 * play button toggles" teaches a step and is not judged; "pnpm wasm:verify" keeps its verify stem
 * inside the dropped command token and is.
 */
export function narratingTestInstructionSegments(text: string): string[] {
    return testInstructionSegments(text).filter(
        (segment) => isCommandNarration(segment) || namesTestSuite(segment) || mentionsCheckCommand(segment)
    );
}

/**
 * Whether any segment of `text` narrates a check. One narrating segment refuses the whole value: a
 * prose sentence beside a command list does not turn the list into a step, it only hides the list
 * from a looser reading.
 */
export function testInstructionsNarrateChecks(text: string): boolean {
    return narratingTestInstructionSegments(text).length > 0;
}

/**
 * The contract gate for a product-scope change's How-to-test section: a value that recites commands
 * the author or CI already ran, or the specs that cover the change, is refused, because those lines
 * teach a reviewer nothing they can perform in the app. The refusal quotes the segments it judged so
 * the author can see which line to drop. A value larger than a whole pull-request body could never
 * be published, so it is refused before the classifier reads it.
 */
export function assertObservableTestInstructions(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > PULL_REQUEST_BODY_BYTE_LIMIT) {
        fail(`pull-request --test exceeds the ${PULL_REQUEST_BODY_BYTE_LIMIT}-byte pull-request body limit`);
    }
    const judged = narratingTestInstructionSegments(text);
    if (judged.length > 0) {
        fail(`${CHECK_NARRATION_TEST_INSTRUCTIONS_REFUSAL}; judged: ${quoteJudgedSegments(judged)}`);
    }
}

/** The judged segments as the refusal lists them: the first few quoted and bounded, the rest counted. */
function quoteJudgedSegments(segments: string[]): string {
    const quoted = segments.slice(0, QUOTED_SEGMENT_LIMIT).map((segment) => JSON.stringify(boundedSegment(segment)));
    const rest = segments.length - quoted.length;
    return rest > 0 ? `${quoted.join(', ')} and ${rest} more` : quoted.join(', ');
}

/** A segment cut to the quoting bound, by code point so no surrogate pair splits, with an ellipsis when cut. */
function boundedSegment(segment: string): string {
    const characters = [...segment];
    return characters.length > QUOTED_SEGMENT_MAX_CHARACTERS
        ? `${characters.slice(0, QUOTED_SEGMENT_MAX_CHARACTERS).join('')}…`
        : segment;
}
