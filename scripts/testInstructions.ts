/**
 * The How-to-test classifier behind the product-scope `--test` gate: whether a pull request's test
 * instructions narrate checks (commands an author or CI already ran, or the test suite that covers
 * the change) instead of teaching only steps a reviewer performs in the app. `publishLane` refuses
 * the former for a product-scope change; everything here is pure text judgment with no I/O.
 */
import { fail, PULL_REQUEST_BODY_BYTE_LIMIT } from './prContract.ts';
import {
    ARTICLES,
    CHECK_COMMANDS,
    CHECK_SCRIPT_FAMILIES,
    CLOSED_CLASS_FUNCTION_WORDS,
    COMMAND_HEADS,
    ENGLISH_WORD_HEADS,
    CHECK_RUN_NOUNS,
    CHECK_STATUSES,
    FILLER_WORDS,
    OBSERVATION_CUE_STEMS,
    PIPELINE_VERDICT_VERBS,
    REMAINDER_VOCABULARY,
    STATUS_ADVERBS,
    STATUS_LINKING_VERBS,
    TEST_MODIFIED_NOUNS,
    TEST_SUBCOMMAND_HEADS,
    TEST_SUBCOMMAND_PREFIX_VALUE_OPTIONS,
    TEST_SUBCOMMAND_PREFIX_WORDS,
} from './testInstructionVocabulary.ts';

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

/** Leading list markers a How-to-test bullet may carry: dash, asterisk, bullet, `1.`, `1)`, `a)`. */
const LEADING_LIST_MARKER = /^(?:[-*•]\s+|[0-9]+[.)]\s+|[a-z][.)]\s+)/i;

/** Single letters joined by dots (`e.g`, `N.B`), as a pattern fragment: a dotted abbreviation up to its closing dot. */
const DOTTED_ABBREVIATION_SOURCE = '(?:\\p{L}\\.)+\\p{L}';

/**
 * A whole token that is a dotted abbreviation, closing dot optional (`e.g.`, `i.e`, `N.B.`). It
 * introduces the words around it rather than being one of them, so like a letter-free token it
 * drops from the prose remainder: it neither rescues a command line (`E.g. pnpm dev`) nor launches
 * one.
 */
const DOTTED_ABBREVIATION_TOKEN = new RegExp(`^${DOTTED_ABBREVIATION_SOURCE}\\.?$`, 'u');

/**
 * Filler that precedes a command without making the segment anything but narration: the filler
 * words, and a dotted abbreviation, which the peel strips so the command behind it is the launch.
 */
const LEADING_FILLER_WORD = new RegExp(`^(?:${FILLER_WORDS.join('|')}|${DOTTED_ABBREVIATION_SOURCE}\\.?)\\s+`, 'iu');

/**
 * A letter or digit. An apostrophe with one immediately on both sides (`track's`, `doesn't`) is
 * part of the word and never opens or closes a single-quoted span. A quote of any kind directly
 * after one (`clips' ends`, `12"`) ends a word rather than starting a quotation, so it never opens a
 * span, though it still closes an open span of its own kind. Opening quotes in ordinary text follow
 * whitespace, punctuation, or the line start: `click 'Cut Clip'` and
 * `python -c 'import json; print(1)'` each stay one quoted span. The sentence split
 * (`isInWordApostrophe`, `followsWordCharacter`) and both quoted-span patterns read quotes the same
 * way, so a possessive can neither hold the rest of its line open against the split nor pair with a
 * later quote into a span that hides the prose between them.
 */
const WORD_CHARACTER = '[\\p{L}\\p{N}]';

/** An apostrophe inside a word, as a pattern fragment. */
const IN_WORD_APOSTROPHE = `(?<=${WORD_CHARACTER})'(?=${WORD_CHARACTER})`;

/**
 * A terminated quoted span (backtick, single quote, or double quote) whose opening quote follows no
 * letter or digit. A single-quoted span carries in-word apostrophes inside and closes on the first
 * apostrophe that is not one.
 */
const QUOTED_SPAN_SOURCE = `(?<!${WORD_CHARACTER})(\`[^\`]*\`|'(?:[^']|${IN_WORD_APOSTROPHE})*(?!${IN_WORD_APOSTROPHE})'|"[^"]*")`;

/** One code point that is a letter or digit, for the sentence split's per-character quote tests. */
const WORD_CHARACTER_ONLY = new RegExp(`^${WORD_CHARACTER}$`, 'u');

/** Leading quoted spans (backtick, single quote, or double quote), for peeling the launch off a segment's front. */
const LEADING_QUOTED_SPAN = new RegExp(`^${QUOTED_SPAN_SOURCE}`, 'u');

/** Any terminated quoted span (backtick, single quote, or double quote), for removing quoted commands from a segment's prose remainder. */
const QUOTED_SPAN = new RegExp(QUOTED_SPAN_SOURCE, 'gu');

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
 * vocabulary and `(confirm` the cue test exactly as their unpunctuated spellings would. Markdown
 * emphasis markers (`*`, `_`, `~`) ride along too, so `**pnpm lint**` classifies exactly as the
 * bare `pnpm lint` it renders as.
 */
const TOKEN_EDGE_PUNCTUATION = /^[,;:()*_~]+|[,;:()*_~]+$/g;

/**
 * A `NAME=value` token: an environment assignment prefix is command material, never the leading
 * prose word that rescues a launch behind it (`SOURDAW_E2E_PORT=4010 pnpm test:e2e …`).
 */
const ENV_ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A trailing `.ts`-style extension: a token shaped like a filename is command material no prose rides on. */
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9]+$/;

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
 * token, the token that follows it (the follower probe), and the quoted-span facts. The peel is
 * an unwrap-and-strip alternation — list markers first, then a leading quoted span unwrapped to
 * its content and leading filler words stripped, each exposing the other, both strictly shortening
 * the remainder. A leading span marks the launch quoted and reports how many tokens its content
 * held: more than the head alone means the span already consumed the head's subcommand slot inside
 * the quotes; the head alone leaves the slot behind the span, so the follower probe consults the
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
 * keeps the run closed — '`make` a MIDI track' is the step's own verb naming its object, not a
 * launch — and an English-word lead never opens one. Only articles close the run here: the heads
 * that reach this test were typed as commands (quoted, a tool name, or beside command-shaped
 * tokens), so a copula behind one makes the command the subject of a narrating sentence.
 */
function opensArgumentRun(launch: PeeledLaunch, segment: string): boolean {
    if (isEnglishWordLead(launch, segment)) {
        return false;
    }
    const lead = launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return (COMMAND_HEADS.has(lead) || ENV_ASSIGNMENT_TOKEN.test(lead)) && !ARTICLES.includes(launchFollower(launch));
}

/** The token directly behind the peeled head, edge punctuation stripped and lower-cased. */
function launchFollower(launch: PeeledLaunch): string {
    return launch.follower.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
}

/**
 * Whether the peeled lead is an English word rather than a launch: an unquoted member of
 * `ENGLISH_WORD_HEADS`, in any letter case and wherever the peel exposes it (behind a stripped
 * filler word, at the start of a `;` or `.` clause), in a segment carrying no command-shaped token.
 * The word class decides, never the casing: a sentence may open lower-case (`Then go to bar 9`) and
 * a tool line may be capitalized (`Pnpm dev`, `Cargo build succeeds`), so a tool head opens its
 * argument run exactly as its lower-case spelling does. A flag, path, colon suffix, filename, or env
 * assignment beside the head shows the segment is a command line after all (`go test ./...`); a
 * quoted head was typed as a command, so it stays a launch. Letter-free tokens (`1.1.1`, `0:00`)
 * are positions and values, never that evidence. The head itself still drops from the prose, so an
 * English-word lead followed only by annotation (`make test`) keeps narrating through
 * `leadsWithCommandMaterial` unless a closed-class function word directly behind it shows English
 * syntax (`Find the new file`, `Go to 1.1.1`, `Echo is still on`).
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
    const tokens = remainder.split(/\s+/).map(remainderToken);
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
 * One remainder token, edge punctuation stripped and lower-cased. A dotted abbreviation blanks
 * like a removed quoted span, so the scan skips it and the run-ending check finds no material in it.
 */
function remainderToken(token: string): string {
    const bare = token.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return DOTTED_ABBREVIATION_TOKEN.test(bare) ? '' : bare;
}

/**
 * Whether a command head or a command-shaped token (path, flag, dotted name) sits in the peeled
 * leading position. An English-word lead counts unless a closed-class function word directly
 * behind it shows English syntax: `make test` is the launch it reads as, while `Find the new
 * file`, `Head to 1:30`, and `Tail is unchanged` are sentences. A copula that only carries a check
 * verdict (`Diff is clean`, `Format is still green`) reports the command's result, so the lead
 * stays launch material.
 */
function leadsWithCommandMaterial(segment: string): boolean {
    const launch = peeledLaunch(segment);
    if (isEnglishWordLead(launch, segment)) {
        return !CLOSED_CLASS_FUNCTION_WORDS.has(launchFollower(launch)) || reportsOnlyCheckVerdict(launch, segment);
    }
    const lead = launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return COMMAND_HEADS.has(lead) || isCommandToken(lead);
}

/** Whether every word behind the peeled lead is one check verdict: `is clean`, `is still green`. */
function reportsOnlyCheckVerdict(launch: PeeledLaunch, segment: string): boolean {
    const tokens = unwrappedTokens(segment);
    const lead = launch.lead.replace(TOKEN_EDGE_PUNCTUATION, '').toLowerCase();
    return CHECK_VERDICT_ONLY.test(tokens.slice(tokens.indexOf(lead) + 1).join(' '));
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
 * sides (`the track's fader`, `doesn't`) is part of its word, and a quote directly after a letter
 * or digit (`the clips' ends`) opens no span, so a possessive never merges the sentences behind it
 * into one segment; empty pieces from separators and blank lines
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
 * a double-quoted message never ends it; a quote directly after a letter or digit never opens one,
 * and an in-word apostrophe neither opens nor closes one;
 * the separator itself drops, every other character (opening and closing quotes included) stays
 * for the launch peel and the quoted-span removal downstream. The dot closing a dotted
 * abbreviation (`e.g.`, `i.e.`, `N.B.`) ends no sentence and stays in its segment.
 */
function splitOutsideQuotedSpans(line: string): string[] {
    const characters = [...line];
    const segments: string[] = [];
    let current = '';
    let chain = 0;
    let quote: string | undefined;
    for (const [index, character] of characters.entries()) {
        const isQuote = character === '`' || character === "'" || character === '"';
        if (quote === undefined && isQuote && !followsWordCharacter(characters, index)) {
            quote = character;
        } else if (character === quote && !isInWordApostrophe(characters, index)) {
            quote = undefined;
        }
        if (quote === undefined && (character === '.' || character === ';')) {
            const next = characters[index + 1];
            const closesAbbreviation = character === '.' && isDottedAbbreviationChain(chain);
            if ((next === undefined || /\s/.test(next)) && !closesAbbreviation) {
                segments.push(current);
                current = '';
                chain = 0;
                continue;
            }
        }
        current += character;
        chain = nextAbbreviationChain(chain, character);
    }
    segments.push(current);
    return segments;
}

/** One letter, for the abbreviation chain's per-character test. */
const LETTER_ONLY = /^\p{L}$/u;

/**
 * The length of the letter-dot alternation (`e`, `e.`, `e.g`) the current token holds from its
 * start once `character` joins it, or -1 once the token breaks the alternation; whitespace starts
 * a new token. Tracked per character so the abbreviation test at a dot costs constant time rather
 * than a rescan of the text before it.
 */
function nextAbbreviationChain(chain: number, character: string): number {
    if (/\s/.test(character)) {
        return 0;
    }
    if (chain < 0) {
        return -1;
    }
    const continues = chain % 2 === 0 ? LETTER_ONLY.test(character) : character === '.';
    return continues ? chain + 1 : -1;
}

/**
 * Whether the current token is a dotted abbreviation missing only its closing dot (`e.g`, `N.B`):
 * single letters joined by dots, ending on a letter. A single letter (`Press A.`) carries no inner
 * dot and still ends its sentence.
 */
function isDottedAbbreviationChain(chain: number): boolean {
    return chain >= 3 && chain % 2 === 1;
}

/** Whether the code point just before `index` is a letter or digit, so a quote at `index` cannot open a span. */
function followsWordCharacter(characters: readonly string[], index: number): boolean {
    return WORD_CHARACTER_ONLY.test(characters[index - 1] ?? '');
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
 * by tests`) or a qualified suite (`unit suite`, `the test suite`) names coverage. `existing`
 * names coverage on the plural, the suite, and a singular `test` that modifies none of the DAW
 * nouns in `TEST_MODIFIED_NOUNS`: `the existing test covers this` is coverage, while `an existing
 * test project` is something a reviewer opens.
 */
const TEST_SUITE_WORDS = new RegExp(
    `\\b(?:specs?|e2e|tests|test suites?|(?:unit|integration|end-to-end)[- ](?:tests?|suites?)|existing[- ](?:tests|suites?|test(?![- ](?:${TEST_MODIFIED_NOUNS.join('|')})s?\\b)))\\b|__tests__/`,
    'i'
);

/**
 * A check verdict, as a pattern fragment: a linking verb, an optional adverb, and a status (`is
 * green`, `is still clean`, `turned red`).
 */
const CHECK_VERDICT_SOURCE = `(?:${STATUS_LINKING_VERBS.join('|')})\\s+(?:(?:${STATUS_ADVERBS.join('|')})\\s+)?(?:${CHECK_STATUSES.join('|')})\\b`;

/** A status phrase behind a check's name, as a pattern fragment: ` is green`, ` was already red`. */
const STATUS_PHRASE = `\\s+${CHECK_VERDICT_SOURCE}`;

/** Words that are exactly a check verdict and nothing else: `is clean`, `is still green`. */
const CHECK_VERDICT_ONLY = new RegExp(`^${CHECK_VERDICT_SOURCE}$`);

/**
 * Markdown emphasis markers and backticks, removed before the multi-word check-name and status
 * patterns read a segment, so `**Gate** is green` and `The \`suite\` is green` read as the plain
 * sentences they render as.
 */
const EMPHASIS_AND_BACKTICKS = /[*_~`]/g;

/**
 * The repository's own check names, matched case-sensitively as the proper nouns they are.
 * `HeavyGate` names nothing else, so it matches bare. `Gate` is also the DAW's noise-gate device
 * (`Add a Gate to track 1`, `Gate passes signal below the threshold`), so it names the check only
 * with a status phrase (`Gate is green`) or a check noun (`the Gate check passed`) behind it.
 */
const REPOSITORY_CHECK_NAMES = new RegExp(
    `\\bHeavyGate\\b|\\bGate(?:${STATUS_PHRASE}|\\s+(?:${CHECK_RUN_NOUNS.join('|')})s?\\b)`
);

/**
 * A suite or the pipeline reported with its status (`The suite is green`) or a pipeline verdict
 * (`pipeline validates the current head`), in any letter case. A bare `suite` stays out: a plugin
 * suite is something a reviewer loads.
 */
const SUITE_OR_PIPELINE_STATUS = new RegExp(
    `\\b(?:suites?|pipeline)${STATUS_PHRASE}|\\bpipeline\\s+(?:${PIPELINE_VERDICT_VERBS.join('|')})\\b`,
    'i'
);

/**
 * The repository's test runners, named as proper nouns. Matched case-sensitively: prose capitalizes a runner's
 * name (`Covered by Playwright`), while the lower-case spelling is the command a launch types
 * (`pnpm exec playwright open the app …`), which the narration rule judges instead.
 */
const TEST_RUNNER_NAMES = /\b(?:Vitest|Playwright)\b/;

/** `CI`, matched case-sensitively so a lower-case `ci` token and the letters inside words stay out. */
const CI_WORD = /\bCI\b/;

function namesTestSuite(segment: string): boolean {
    const plain = segment.replace(EMPHASIS_AND_BACKTICKS, '');
    return (
        TEST_SUITE_WORDS.test(segment) ||
        TEST_RUNNER_NAMES.test(segment) ||
        CI_WORD.test(segment) ||
        REPOSITORY_CHECK_NAMES.test(plain) ||
        SUITE_OR_PIPELINE_STATUS.test(plain)
    );
}

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
            (TEST_SUBCOMMAND_HEADS.has(token) && runsTestSubcommand(tokens, index + 1))
    );
}

/**
 * Whether the tokens from `start` reach a `test` subcommand once the runner words and options a
 * head may carry before it are skipped, in any order and number: `pnpm --filter x -r run test`.
 */
function runsTestSubcommand(tokens: readonly string[], start: number): boolean {
    let index = start;
    while (index < tokens.length) {
        const token = tokens[index] ?? '';
        if (token === 'test') {
            return true;
        }
        if (TEST_SUBCOMMAND_PREFIX_WORDS.has(token) || isInlineValueOption(token)) {
            index += 1;
        } else if (TEST_SUBCOMMAND_PREFIX_VALUE_OPTIONS.has(token)) {
            index += 2;
        } else {
            return false;
        }
    }
    return false;
}

/** Whether a token is a value option carrying its value behind `=`: `--filter=x`. */
function isInlineValueOption(token: string): boolean {
    const equals = token.indexOf('=');
    return equals > 0 && TEST_SUBCOMMAND_PREFIX_VALUE_OPTIONS.has(token.slice(0, equals));
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
