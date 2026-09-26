/**
 * The word inventories the How-to-test classifier (`testInstructions.ts`) judges segments by: command
 * heads, the annotation vocabulary, observation-cue stems, filler words, English closed-class words,
 * and the check-command families. Pure data with no local imports, so the classifier's rules and the
 * words they read stay separately reviewable.
 */

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

/**
 * Articles whose presence directly behind a quoted or tool command head keeps the argument run
 * closed: '`make` a MIDI track' is the step's own verb naming its object. Only articles do this
 * there: behind a head typed as a command, a copula makes the command the sentence's subject
 * ('`diff` is empty', `Git is empty`), which is narration whose words the run must still eat.
 */
export const ARTICLES = ['a', 'an', 'the'];

/**
 * English closed-class function words — articles, pronouns and determiners, prepositions and
 * particles, auxiliary and copular verbs — whose presence directly behind an English-word lead
 * shows English syntax, so the lead is no launch material: `Make a MIDI track`, `Make it the
 * same`, `Go to 1.1.1`, and `Echo is still on` are the step's own verb or subject followed by its
 * sentence. A bare argument (`make test`) is still the launch it reads as. Quantifiers (`all`,
 * `both`, `each`, `everything`) stay out: they are also the bare targets a build tool runs
 * (`make all`), so behind a head they show no English syntax. Exported so the specs
 * can pin the inventory: dropping any member reddens the equality pin and that member's
 * behavioral case.
 */
export const CLOSED_CLASS_FUNCTION_WORDS = new Set([
    ...ARTICLES,
    'it',
    'its',
    'this',
    'that',
    'these',
    'those',
    'them',
    'to',
    'back',
    'by',
    'as',
    'at',
    'in',
    'into',
    'on',
    'onto',
    'off',
    'from',
    'with',
    'through',
    'over',
    'under',
    'up',
    'down',
    'out',
    'past',
    'around',
    'before',
    'after',
    'is',
    'are',
    'was',
    'were',
    'be',
    'stays',
    'remains',
    'should',
    'must',
    'will',
    'can',
    'sounds',
    'still',
]);

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

/**
 * The closed vocabulary a command-only segment's leftover words may draw from before it stops
 * being narration: the result statuses a command line cites, and the command-annotation words
 * (the filler set plus the copula, prepositions, and scope words). Anything beyond it is real
 * instruction.
 */
export const REMAINDER_VOCABULARY = new Set([
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
export const OBSERVATION_CUE_STEMS = [
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

/**
 * The command heads that are also ordinary English imperative verbs a DAW step can open with
 * (`Go to Settings`, `sort by name`, `make track 2 mono`). Heads whose English use is itself check
 * narration (`lint`, `typecheck`, the colon-bearing scripts) and tool names stay out, so they open
 * an argument run whatever their letter case.
 */
export const STEP_VERB_HEADS = ['diff', 'echo', 'find', 'format', 'go', 'head', 'less', 'make', 'sort', 'tail'];

/**
 * The command heads that are also ordinary English words a DAW step or its expected result can
 * carry: the step verbs, plus the nouns and pronouns a result sentence names (`Node 2 is gone`,
 * `the cat`, `which track`). Their mere presence is no command evidence; only a quoted spelling or
 * a command-shaped token beside them shows the segment is a command line. Tool names (`pnpm`,
 * `git`, `cargo`) stay out, so their presence alone keeps reading as a launch.
 */
export const ENGLISH_WORD_HEADS = new Set([
    ...STEP_VERB_HEADS,
    'node',
    'env',
    'which',
    'electron',
    'guard',
    'tee',
    'cat',
]);

/** Script families every member of which runs a check: `test:run`, `typecheck:scripts`, `lint:fix`, `cargo:test`. */
export const CHECK_SCRIPT_FAMILIES = new Set(['test', 'typecheck', 'lint', 'cargo']);

/** Check scripts and tools that run nothing but a check: a reviewer never launches one to use the app. */
export const CHECK_COMMANDS = new Set([
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
export const TEST_SUBCOMMAND_HEADS = new Set(['pnpm', 'npm', 'yarn', 'bun', 'cargo', 'go', 'make', 'playwright']);

/**
 * The runner words and flags that may stand alone between a suite-running head and its `test`
 * subcommand without changing what runs: `pnpm run test`, `pnpm -r test`. Exported so the specs
 * can pin the inventory: dropping any member reddens the equality pin and that member's case.
 */
export const TEST_SUBCOMMAND_PREFIX_WORDS = new Set(['run', '-r', '--recursive']);

/**
 * The runner options that take a value between a suite-running head and its `test` subcommand,
 * written either as the next token (`pnpm --filter x test`, `pnpm -F x test`) or behind `=`
 * (`pnpm --filter=x test`). Exported so the specs can pin the inventory like the prefix words.
 */
export const TEST_SUBCOMMAND_PREFIX_VALUE_OPTIONS = new Set(['--filter', '-F']);

/**
 * The DAW nouns a singular `test` may modify: `an existing test project` is something a reviewer
 * opens, while `the existing test` with no such noun behind it names coverage. `file` stays out:
 * `the existing test file` is the spec file far more often than an audio file. Exported so the
 * specs can pin the inventory: dropping any member reddens the equality pin and that member's case.
 */
export const TEST_MODIFIED_NOUNS = [
    'project',
    'session',
    'song',
    'track',
    'clip',
    'take',
    'tone',
    'signal',
    'recording',
    'mix',
    'sample',
];

/** The verbs that link a check's name to its status: `Gate is green`, `the suite stays clean`. */
export const STATUS_LINKING_VERBS = ['is', 'are', 'was', 'were', 'stays', 'remains', 'goes', 'went', 'turns', 'turned'];

/**
 * The adverbs a status phrase may carry between its linking verb and its status: `Gate is still
 * green`, `the pipeline is now green`. Exported so the specs can pin the inventory: dropping any
 * member reddens the equality pin and that member's case.
 */
export const STATUS_ADVERBS = ['still', 'now', 'already', 'again'];

/** The statuses a check is reported with. */
export const CHECK_STATUSES = ['green', 'red', 'clean', 'passing', 'failing'];

/**
 * The statuses that make `Gate` the repository's check rather than the DAW's noise-gate device. The
 * device itself is passing signal, failing to close, clean of chatter, or red on its meter, so
 * only `green` is left to the check. Exported so the specs can pin the inventory: adding a device
 * status reddens the equality pin and the device sentences that use it.
 */
export const GATE_CHECK_STATUSES = ['green'];

/**
 * The nouns that make `Gate` the repository's check rather than the DAW device: `the Gate check`,
 * `the Gate jobs`. Plurals are listed only where they cannot be a verb: `the Gate checks the
 * sidechain` and `the Gate runs before the compressor` describe the device.
 */
export const CHECK_RUN_NOUNS = ['check', 'job', 'jobs', 'run', 'workflow', 'workflows'];

/** The verdict verbs a suite or the pipeline reports with: `the suite passed`, `the pipeline validates the head`. */
export const SUITE_OR_PIPELINE_VERDICT_VERBS = ['validates', 'validated', 'passes', 'passed', 'fails', 'failed'];
