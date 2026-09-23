/**
 * The structural pins of the advisory semantic-review workflow.
 *
 * This file exists because the workflow is the one place in the repository where a paid external
 * credential, a `pull_request_target` trigger, and pull-request-controlled content meet. Each of the
 * three properties is safe only in combination with the others, so they are pinned together rather
 * than reviewed as prose: the head is read as Git objects and never checked out, the key is scoped to
 * the single step that sends it, and no token in the job can write anything at all.
 *
 * The workflow-level snapshot in `healthGateWorkflowContract.ts` already pins every key of the parsed
 * file, so an edit of any kind fails the harness until the record is regenerated. These pins are the
 * named vectors beside it: they say which properties must hold and refuse the specific rearrangements
 * that would keep the file's shape while moving the credential or the head across the boundary.
 */

export const SEMANTIC_REVIEW_WORKFLOW_FILE = 'semantic-review.yml';

/** The job whose check a reader sees. Distinct from `Gate` and `HeavyGate`, which no file but theirs may mint. */
export const SEMANTIC_REVIEW_CHECK_NAME = 'Semantic review';

/** The job that performs the assessment and holds the provider key. */
export const SEMANTIC_REVIEW_ASSESS_JOB = 'assess';

/**
 * The commit the executed command comes from. `github.workflow_sha` is the base revision under
 * `pull_request_target`; the head's own sha must never appear as a checkout or fetch target.
 */
export const SEMANTIC_REVIEW_TRUSTED_REVISION_EXPRESSION = '${{ github.workflow_sha }}';

/** The reviewed head, which this workflow may read as Git objects and never execute. */
export const SEMANTIC_REVIEW_HEAD_EXPRESSION = '${{ github.event.pull_request.head.sha }}';

/** The provider key. The secret name is the owner's; the variable name is the command's contract. */
export const SEMANTIC_REVIEW_KEY_ENV = 'TYPESAFE_API_KEY';
export const SEMANTIC_REVIEW_KEY_SECRET_EXPRESSION = '${{ secrets.JEV_KEY }}';

/** The one dependency installation this job may run. */
export const SEMANTIC_REVIEW_INSTALL_COMMAND = 'pnpm install --frozen-lockfile --ignore-scripts';

/** The only token this job may hold: the run's own read-scoped credential, not a personal one. */
export const SEMANTIC_REVIEW_READ_TOKEN_EXPRESSION = '${{ github.token }}';

/** The word every repository-secret reference contains, however the expression is spelled. */
export const SECRET_KEYWORD = 'secrets';

export const SEMANTIC_REVIEW_TRIGGERS = ['pull_request_target', 'workflow_dispatch'] as const;
export const SEMANTIC_REVIEW_TARGET_TYPES = ['opened', 'synchronize', 'reopened', 'ready_for_review'] as const;

/**
 * Everything the job may have. `checks: write` is the tempting addition — the workflow publishes a
 * check — and it is refused: this job's check, step summary, and artifact need no write token, and a
 * token that can write would sit beside the key for no benefit.
 */
export const SEMANTIC_REVIEW_PERMISSIONS: Readonly<Record<string, string>> = {
    contents: 'read',
    'pull-requests': 'read',
};

/**
 * The workflow environment is executable surface like any other: a `PATH`, a `BASH_ENV`, or any
 * shadowing variable set here reaches every pinned command in both jobs. It is pinned whole for the
 * three values the workflow needs, so a fourth entry is refused here rather than only snapshotted.
 */
export const SEMANTIC_REVIEW_ENV: Readonly<Record<string, string>> = {
    NODE_VERSION: '24.19.0',
    PR_NUMBER: '${{ github.event.pull_request.number || inputs.pr }}',
    TRUSTED_SHA: '${{ github.workflow_sha }}',
};

/**
 * The only actions the job may invoke. An added action is an added supply-chain surface inside the
 * one workflow that holds the key, so the set is pinned rather than merely reviewed.
 */
export const SEMANTIC_REVIEW_ACTIONS = [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
] as const;

export const SEMANTIC_REVIEW_STEPS = [
    'Checkout the trusted revision',
    'Fetch the reviewed head as Git objects',
    'Set up pnpm',
    'Set up Node',
    'Install dependencies',
    'Assess the change',
    'Report the assessment',
    'Upload the advisory report',
    'Compute the coverage line',
] as const;

export const SEMANTIC_REVIEW_CHECKOUT_STEP = 'Checkout the trusted revision';

/**
 * The whole of the one step that is handed the provider key, compared exactly.
 *
 * The credential-bearing command is the last one that may be pinned by search: a substring check
 * accepted any appended command, so `curl` sending the key to an arbitrary host passed every named
 * assertion while the step still "ran the repository scan command". The property is that this step
 * runs the scan invocation and nothing else.
 */
export const SEMANTIC_REVIEW_ASSESS_COMMAND = [
    'set -euo pipefail',
    'report_directory="$RUNNER_TEMP/semantic-review"',
    'mkdir -p "$report_directory"',
    'set +e',
    'node scripts/semanticReview.ts scan \\',
    '  --pr "$PR_NUMBER" \\',
    '  --trusted-sha "$TRUSTED_SHA" \\',
    '  --out "$report_directory/scan.json" 2>&1 | tee "$report_directory/run.log"',
    'status=${PIPESTATUS[0]}',
    'set -e',
    'printf \'%s\\n\' "$status" > "$report_directory/exit-code"',
].join('\n');

/** The whole of the step that decides the job's conclusion, compared exactly. */
export const SEMANTIC_REVIEW_REPORT_COMMAND = [
    'set -euo pipefail',
    'report_directory="$RUNNER_TEMP/semantic-review"',
    'summary="$report_directory/summary.md"',
    '{',
    "  printf '## Jev semantic review (advisory)\\n\\n'",
    "  printf 'Advice for this pull request, not a reviewer draw and not a required check. A green result means the assessment was delivered, never that the change is clean.\\n\\n'",
    '  if [ -f "$summary" ]; then cat "$summary"; else printf \'No assessment was produced.\\n\'; fi',
    '} >> "$GITHUB_STEP_SUMMARY"',
    '',
    'execution=missing',
    'if [ -f "$report_directory/scan.json" ]; then',
    '  execution=$(jq -r \'.execution // "missing"\' "$report_directory/scan.json")',
    'fi',
    'case "$execution" in',
    '  completed | partial)',
    '    printf \'::notice title=Jev semantic review::Assessment delivered (%s). Advisory only: read the job summary, which states what was assessed and what was withheld.\\n\' "$execution"',
    '    exit 0',
    '    ;;',
    '  skipped)',
    '    # No changed path admitted a rule — a documentation- or workflow-only change. Nothing was',
    '    # eligible, so nothing was missed, and failing the check for that would put a red advisory',
    '    # mark on the class of change that needs it least.',
    "    printf '::notice title=Jev semantic review::No changed path admitted a rule, so there was nothing to assess.\\n'",
    '    exit 0',
    '    ;;',
    'esac',
    "printf '::error title=Jev semantic review::No assessment was delivered (execution=%s, exit=%s). Treat this pull request as having no semantic coverage.\\n' \\",
    '  "$execution" "$(cat "$report_directory/exit-code")"',
    'exit 1',
].join('\n');

/**
 * The whole of the one step allowed to touch a repository object. It is compared exactly rather than
 * searched, because enumerating the ways to move a working tree (`checkout`, `switch`, `restore`,
 * `reset --hard`, `worktree add`, `read-tree -u`, a `-c` flag, an explicit `--work-tree`) is a list
 * that cannot be finished and was already incomplete: the fetch is the only git this may run.
 */
export const SEMANTIC_REVIEW_HEAD_FETCH_COMMAND = [
    'set -euo pipefail',
    'git fetch --no-tags origin "+refs/pull/${PR_NUMBER}/head:refs/remotes/pull/${PR_NUMBER}/head"',
].join('\n');
export const SEMANTIC_REVIEW_ASSESS_STEP = 'Assess the change';
export const SEMANTIC_REVIEW_SCAN_COMMAND = 'node scripts/semanticReview.ts scan';

/**
 * The one artifact name both sides use, scoped to the run and the attempt. Sharing it is the point:
 * the upload's name and the download's name are the same string only because both read it here, and
 * the attempt suffix is what keeps a re-run from colliding with the previous attempt's immutable
 * artifact — a run-scoped name would fail the new upload while the softened download still read the
 * superseded report.
 */
export const SEMANTIC_REVIEW_ARTIFACT_NAME =
    'semantic-review-${{ env.PR_NUMBER }}-${{ github.run_id }}-${{ github.run_attempt }}';
/** The one step that publishes the report the coverage job reads back. */
export const SEMANTIC_REVIEW_UPLOAD_STEP = 'Upload the advisory report';
export const SEMANTIC_REVIEW_UPLOAD_ACTION = SEMANTIC_REVIEW_ACTIONS[3];
export const SEMANTIC_REVIEW_UPLOAD_INPUTS: Readonly<Record<string, string | number>> = {
    name: SEMANTIC_REVIEW_ARTIFACT_NAME,
    path: '${{ runner.temp }}/semantic-review',
    'retention-days': 7,
};
/** The Node version the assessment runs on. Pinned as an input as well as through the workflow env. */
export const SEMANTIC_REVIEW_NODE_SETUP_INPUTS: Readonly<Record<string, string>> = {
    'node-version': '${{ env.NODE_VERSION }}',
};

/** The step that turns the report into the one-line output the coverage job is named from. */
export const SEMANTIC_REVIEW_COVERAGE_STEP = 'Compute the coverage line';
export const SEMANTIC_REVIEW_COVERAGE_STEP_ID = 'coverage';
export const SEMANTIC_REVIEW_COVERAGE_OUTPUT = 'coverage';

/**
 * The whole of the computing step, compared exactly: it reads the report and writes one output, and
 * a pinned command is the only thing that keeps a second command from running beside it.
 *
 * The step carries no condition, and it sits after the upload, which is the property the divergence
 * turns on: the default success gate skips it whenever the report or the upload failed, so the line
 * is published only once this attempt uploaded its report, and a line derived from a report that was
 * never uploaded would name a scope no reader could open; the fallback in the coverage job's name
 * names that path instead. It does not follow that the reader can always open the report: a
 * retrieval failure after a successful upload leaves the line standing, and the annotating step
 * reports that failed fetch rather than an absent report.
 */
export const SEMANTIC_REVIEW_COVERAGE_COMMAND = [
    'set -euo pipefail',
    'report_directory="$RUNNER_TEMP/semantic-review"',
    "coverage='no assessment delivered'",
    'if [ -f "$report_directory/scan.json" ]; then',
    '  # A withheld entry is one the report counted as unassessed or as a',
    '  # truncated region — together its own definition of an incomplete',
    '  # assessment, and a completed run carries neither. The count is over',
    '  # distinct path-and-reason pairs: the producer emits one identical',
    '  # entry per over-budget region of a file, and counting those repeats',
    "  # would inflate the line, while dropping the pair's reason would hide",
    '  # it, so identical pairs collapse and every distinct reason stays.',
    '  computed=$(jq -r \'"\\(.execution) · \\(.scope.discovered) discovered · \\(.scope.eligible) eligible · \\(.scope.assessed) assessed · \\(([.scope.unassessed[], .scope.truncated[]] | unique_by([.path, .reason]) | length)) withheld"\' "$report_directory/scan.json" 2>/dev/null || true)',
    '  if [ -n "$computed" ]; then',
    '    coverage=$computed',
    '  fi',
    'fi',
    'printf \'coverage=%s\\n\' "$coverage" >> "$GITHUB_OUTPUT"',
].join('\n');

/** The job that reads the run's own artifact back and annotates the withheld paths. */
export const SEMANTIC_REVIEW_COVERAGE_JOB = 'coverage';
/**
 * The job's whole name, built from the assessment's own output. This is the observable: an agent
 * reading the checks list sees the scope because the name carries it, never because it opened a log.
 *
 * The fallback lives in this expression rather than in the assessment job's `outputs`, because a job
 * that never ran never evaluates its outputs mapping: this is the expression that actually runs on
 * the red and skipped paths, so it is where naming them can work.
 */
export const SEMANTIC_REVIEW_COVERAGE_JOB_NAME =
    "Jev coverage · ${{ needs.assess.outputs.coverage || 'no assessment delivered' }}";
export const SEMANTIC_REVIEW_COVERAGE_JOB_CONDITION = '${{ !cancelled() }}';
/** The job needs nothing from the repository but the run's artifact, so it may hold nothing else. */
export const SEMANTIC_REVIEW_COVERAGE_JOB_PERMISSIONS: Readonly<Record<string, string>> = { contents: 'read' };
export const SEMANTIC_REVIEW_COVERAGE_STEPS = ['Download the advisory report', 'Publish the withheld paths'] as const;
export const SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_STEP = 'Download the advisory report';
/** The fetch's outcome is published under this id, which is what tells a failed retrieval from a run that never published. */
export const SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_STEP_ID = 'download';
/**
 * A missing artifact is an expected outcome — the assessment job uploads one only when it delivered
 * a report — so the fetch is softened and the annotating step reports the absence. Softening is safe
 * precisely because the fetch proves nothing: the step that reads its result still runs, and its id
 * lets that step say which absence happened.
 */
export const SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_ACTION =
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
export const SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_INPUTS: Readonly<Record<string, string>> = {
    name: SEMANTIC_REVIEW_ARTIFACT_NAME,
    path: '${{ runner.temp }}/semantic-review',
};
export const SEMANTIC_REVIEW_COVERAGE_ANNOTATE_STEP = 'Publish the withheld paths';
/**
 * The annotating step's whole environment, and the only step environment in this workflow besides
 * the assessment step's. The fetch's raw outcome distinguishes a failed retrieval from a run that
 * never published, and the coverage line — written only after a successful upload — is the fact that
 * says this run did publish. Both are pinned, so no third variable can join them.
 */
export const SEMANTIC_REVIEW_COVERAGE_ANNOTATE_ENV: Readonly<Record<string, string>> = {
    DOWNLOAD_OUTCOME: '${{ steps.download.outcome }}',
    COVERAGE_LINE: '${{ needs.assess.outputs.coverage }}',
};

/** The whole of the annotating step, compared exactly: it emits notices from the report and nothing else. */
export const SEMANTIC_REVIEW_COVERAGE_ANNOTATE_COMMAND = [
    'set -euo pipefail',
    'report_directory="$RUNNER_TEMP/semantic-review"',
    'report="$report_directory/scan.json"',
    'withheld_list="$report_directory/withheld-notices.txt"',
    'if [ ! -f "$report" ]; then',
    '  if [ "$DOWNLOAD_OUTCOME" = \'failure\' ] && [ -n "$COVERAGE_LINE" ]; then',
    "    printf '::notice title=Jev coverage::The advisory report could not be retrieved: this run published one, but the artifact download failed.\\n'",
    '    exit 0',
    '  fi',
    "  printf '::notice title=Jev coverage::No coverage was reported: the assessment published no artifact or report for this run.\\n'",
    '  exit 0',
    'fi',
    '',
    '# One annotation per distinct withheld path-and-reason pair, in the',
    '# order the report lists them. The producer emits one identical entry',
    '# per over-budget region of a file, so the pairs are deduplicated while',
    '# every distinct reason is kept: emitting the repeats would spend the',
    '# budget on the same notice and hide a distinct reason, and sorting the',
    '# survivors would let the ten-entry budget fall on alphabet rather than',
    "# on the report's own order. The `file=` property is identity-bearing,",
    '# so it is escaped exactly and never folded: folding a control',
    '# character into a space would annotate two paths under one name and',
    '# attribute a reason to the wrong file. The property escapes `%`, a',
    '# carriage return, a newline, `:`, and `,`; the displayed text escapes',
    '# `%`, a carriage return, and a newline.',
    "if ! jq -r '",
    '  def esc_data: gsub("%"; "%25") | gsub("\\r"; "%0D") | gsub("\\n"; "%0A");',
    '  def esc_prop: esc_data | gsub(":"; "%3A") | gsub(","; "%2C");',
    '  [.scope.unassessed[], .scope.truncated[]]',
    '  | reduce .[] as $entry (',
    '      { seen: {}, distinct: [] };',
    '      ($entry | [.path, .reason] | tojson) as $key',
    '      | if .seen[$key] then . else .seen[$key] = true | .distinct += [$entry] end',
    '    )',
    '  | .distinct[]',
    '  | "::notice file=\\(.path | esc_prop),line=1::\\(.path | esc_data): \\(.reason | esc_data)"',
    '\' "$report" > "$withheld_list" 2>/dev/null; then',
    "  printf '::notice title=Jev coverage::The advisory report could not be read: the assessment published an artifact whose report is not readable.\\n'",
    '  exit 0',
    'fi',
    '',
    '# At most ten annotations, one per distinct pair, then one notice',
    '# counting the pairs that were not annotated.',
    'withheld=0',
    'annotated=0',
    'while IFS= read -r notice; do',
    '  withheld=$((withheld + 1))',
    '  if [ "$annotated" -lt 10 ]; then',
    '    printf \'%s\\n\' "$notice"',
    '    annotated=$((annotated + 1))',
    '  fi',
    'done < "$withheld_list"',
    '',
    'printf \'::notice title=Jev coverage::%s further withheld entry(s) were not annotated.\\n\' "$((withheld - annotated))"',
].join('\n');

/**
 * One condition holds every reason this job may not run, because a reason kept beside the others
 * instead of inside them is a reason a tidy-up drops: a fork is a different trust domain and a
 * different spend decision, a draft is not yet under review, and a change proposed to another branch
 * executes that branch's revision of the command, which the command's own trusted-execution
 * assertion refuses — so the workflow declares that scope rather than failing closed on it.
 */
export const SEMANTIC_REVIEW_ELIGIBILITY_CONDITION =
    "${{ !cancelled() && ((github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.draft == false && github.event.pull_request.base.ref == 'main')) }}";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as UnknownRecord;
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Advisory semantic review workflow must retain ${label}`);
    }
}

function named(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a string`);
    }
    return value;
}

function stepsOf(job: UnknownRecord): UnknownRecord[] {
    const steps = job.steps;
    if (!Array.isArray(steps)) {
        throw new TypeError('Advisory semantic review job must declare steps');
    }
    return steps.map((step) => asRecord(step, 'semantic review step'));
}

function stepNamed(steps: readonly UnknownRecord[], name: string): UnknownRecord {
    const step = steps.find((candidate) => candidate.name === name);
    if (step === undefined) {
        throw new Error(`Advisory semantic review workflow is missing step ${name}`);
    }
    return step;
}

/**
 * The head is data. A checkout of it would place files the change controls in the tree of a job that
 * holds the key, and the fetch that puts its Git objects in the object database is the only access
 * this workflow may have to it.
 */
function assertHeadIsNeverCheckedOut(workflow: UnknownRecord, job: UnknownRecord): void {
    const serialized = JSON.stringify(workflow);
    if (serialized.includes(SEMANTIC_REVIEW_HEAD_EXPRESSION)) {
        throw new Error('Advisory semantic review workflow must not reference the reviewed head sha');
    }
    for (const step of stepsOf(job)) {
        if (step.uses !== undefined) {
            const withInput = asRecord(step.with ?? {}, 'semantic review action inputs');
            if (withInput.ref !== undefined) {
                requireEqual(withInput.ref, SEMANTIC_REVIEW_TRUSTED_REVISION_EXPRESSION, 'a trusted checkout');
            }
        }
        // The one fetch step is pinned exactly by `assertHeadFetch`; every other step may run no git
        // at all.
        if (step.name === SEMANTIC_REVIEW_STEPS[1]) {
            continue;
        }
    }
}

function assertTrustedCheckout(job: UnknownRecord): void {
    const checkout = stepNamed(stepsOf(job), SEMANTIC_REVIEW_CHECKOUT_STEP);
    requireEqual(checkout.uses, SEMANTIC_REVIEW_ACTIONS[0], 'the pinned checkout action');
    const inputs = asRecord(checkout.with ?? {}, `${SEMANTIC_REVIEW_CHECKOUT_STEP} inputs`);
    requireEqual(inputs.ref, SEMANTIC_REVIEW_TRUSTED_REVISION_EXPRESSION, 'a trusted checkout');
    requireEqual(inputs['fetch-depth'], 0, 'the full history of the trusted revision');
    requireEqual(inputs['persist-credentials'], false, 'no persisted credential in the checked-out tree');
}

/**
 * Every executable string in the job, compared exactly.
 *
 * This is the whole of the no-code-from-the-head property, and it is deliberately not a search.
 * Three earlier revisions matched text instead — three subcommands, then the substring `git`, then a
 * credential expression — and each was defeated by a spelling it did not enumerate (`git reset
 * --hard`, `g''it checkout`, a bracket-indexed secret). Enumerating the ways to run something is a
 * list that cannot be finished; pinning the five commands that may run is a list that is already
 * complete, and any sixth step that tries to run anything fails on the missing entry.
 */
function assertEveryRunIsPinned(job: UnknownRecord): void {
    const pinned: Readonly<Record<string, string>> = {
        [SEMANTIC_REVIEW_STEPS[1]]: SEMANTIC_REVIEW_HEAD_FETCH_COMMAND,
        'Install dependencies': SEMANTIC_REVIEW_INSTALL_COMMAND,
        [SEMANTIC_REVIEW_ASSESS_STEP]: SEMANTIC_REVIEW_ASSESS_COMMAND,
        'Report the assessment': SEMANTIC_REVIEW_REPORT_COMMAND,
        [SEMANTIC_REVIEW_COVERAGE_STEP]: SEMANTIC_REVIEW_COVERAGE_COMMAND,
    };
    const observed: Record<string, string> = {};
    for (const step of stepsOf(job)) {
        if (step.run === undefined) {
            continue;
        }
        const name = named(step.name, 'semantic review step name');
        observed[name] = named(step.run, `${name} run`).trim();
    }
    requireEqual(Object.keys(observed).sort(), Object.keys(pinned).sort(), 'exactly five executable steps');
    for (const [name, command] of Object.entries(pinned)) {
        requireEqual(observed[name], command, `exactly the pinned command in ${name}, and nothing else`);
    }
}

/**
 * One step, and the last one to touch the provider, may hold the key. A workflow- or job-level
 * declaration would put it in the environment of the install and the reporting step too, which need
 * nothing from it, so the credential is required on the assessment step and forbidden everywhere
 * else.
 *
 * Two counts are needed, because one is not the property. Counting the variable *name* catches the
 * same-name rearrangement and misses the real one: `LEAKED_JEV: ${{ secrets.JEV_KEY }}` on another
 * step leaves the name appearing once while the key itself sits in a second environment. So the
 * credential expression is counted too, and any other step's environment is refused outright for
 * naming *any* repository secret — the pin is that this job exposes exactly one, to exactly one step.
 */
function assertKeyIsScopedToTheAssessment(workflow: UnknownRecord, job: UnknownRecord): void {
    const assess = stepNamed(stepsOf(job), SEMANTIC_REVIEW_ASSESS_STEP);
    requireEqual(
        asRecord(assess.env ?? {}, `${SEMANTIC_REVIEW_ASSESS_STEP} environment`)[SEMANTIC_REVIEW_KEY_ENV],
        SEMANTIC_REVIEW_KEY_SECRET_EXPRESSION,
        'the provider key only on the assessment step'
    );
    // The assessment step's environment is pinned whole, which is what fixes where the one allowed
    // mention lives: a second variable cannot be added beside the key.
    requireEqual(
        Object.keys(asRecord(assess.env ?? {}, `${SEMANTIC_REVIEW_ASSESS_STEP} environment`)).sort(),
        ['GH_TOKEN', SEMANTIC_REVIEW_KEY_ENV],
        'exactly the provider key and the read-scoped token on the assessment step'
    );
    // The read-scoped token's value is pinned too: the key set alone accepted a write-capable
    // personal token under the same name, which is the tidy-up a rate-limited run invites and the one
    // thing this job must never hold.
    requireEqual(
        asRecord(assess.env ?? {}, `${SEMANTIC_REVIEW_ASSESS_STEP} environment`).GH_TOKEN,
        SEMANTIC_REVIEW_READ_TOKEN_EXPRESSION,
        'the read-scoped token, and no other, on the assessment step'
    );
    // Reading the environment blocks was not enough, and neither was matching one expression text.
    // The word is counted across the whole parsed file, so a reference placed in a step's `run`, its
    // action inputs, a job or workflow environment, or any spelling of the expression is the same
    // single fact: this workflow mentions a repository secret once, and that mention is the
    // assessment step's key. Everything else about the file is pinned by its own assertions.
    const mentions = JSON.stringify(workflow).split(SECRET_KEYWORD).length - 1;
    if (mentions !== 1) {
        throw new Error(
            'Advisory semantic review workflow must mention a repository secret exactly once, on the assessment step'
        );
    }
}

/**
 * A step's `shell` is executable and, unlike its `run`, is never read by a command pin: appending a
 * command there leaves the step's `run` byte-identical while the shell runs something else — on the
 * step that holds the provider key as much as on any other. Both jobs' steps must therefore carry no
 * shell override at all, which is the one value that can be pinned across a step set this size.
 */
function assertNoShellOverride(steps: readonly UnknownRecord[], label: string): void {
    for (const step of steps) {
        requireEqual(step.shell, undefined, `${label} without a shell override`);
    }
}

/** An absent declaration, or the empty mapping GitHub treats as the same no-op. */
function isEmptyDeclaration(value: unknown): boolean {
    if (value === undefined) {
        return true;
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

function requireNoDeclaration(value: unknown, label: string): void {
    if (!isEmptyDeclaration(value)) {
        throw new Error(`Advisory semantic review workflow must retain ${label}`);
    }
}

/** Order-insensitive equality of two string mappings, so a reordered block is not a boundary change. */
function isSameKeyValueSet(actual: unknown, expected: Readonly<Record<string, string>>): boolean {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
        return false;
    }
    const record = actual as Record<string, unknown>;
    const keys = Object.keys(record);
    const expectedKeys = Object.keys(expected);
    return (
        keys.length === expectedKeys.length &&
        expectedKeys.every((key) => keys.includes(key) && record[key] === expected[key])
    );
}

/**
 * The environment a pinned command runs in is executable surface the command pins cannot see. A
 * workflow- or job-level `defaults` replaces the shell every `run` step uses, a job or step
 * `container` re-environments the job that holds the provider key, and a job or step `env` can set
 * `BASH_ENV` for a command whose text is compared exactly. The two legitimate step environments —
 * the assessment step's and the coverage annotating step's — are pinned whole where they live, and
 * they are the sole exemptions. An absent declaration and an empty mapping are the same no-op.
 */
function assertNoExecutableEnvironment(job: UnknownRecord, label: string, envPinnedStepName?: string): void {
    for (const forbidden of ['defaults', 'container', 'env']) {
        requireNoDeclaration(job[forbidden], `${label} without a job ${forbidden} block`);
    }
    for (const step of stepsOf(job)) {
        requireNoDeclaration(step.container, `${label} steps without a step container`);
        if (step.name !== envPinnedStepName) {
            requireNoDeclaration(step.env, `${label} steps without a step environment`);
        }
    }
}

/**
 * The coverage job is a second reader of the same run, and its whole surface is the artifact the
 * assessment job uploaded. It holds no provider key, checks nothing out, and can write nothing, so
 * the only risk left is that it stops publishing the scope while still reporting green: its name,
 * dependency, condition, permissions, one pinned action, and one pinned command are compared exactly.
 */
function assertCoverageJob(jobs: UnknownRecord): void {
    const job = asRecord(jobs[SEMANTIC_REVIEW_COVERAGE_JOB], 'semantic review coverage job');
    requireEqual(job.name, SEMANTIC_REVIEW_COVERAGE_JOB_NAME, 'a coverage name built from the assessment output');
    requireEqual(job.needs, SEMANTIC_REVIEW_ASSESS_JOB, 'its dependency on the assessment');
    requireEqual(job.if, SEMANTIC_REVIEW_COVERAGE_JOB_CONDITION, 'its run-unless-cancelled condition');
    requireEqual(job['runs-on'], 'ubuntu-latest', 'a standard hosted runner');
    requireEqual(job.permissions, SEMANTIC_REVIEW_COVERAGE_JOB_PERMISSIONS, 'contents: read alone');
    for (const forbidden of ['continue-on-error', 'environment', 'uses', 'secrets']) {
        requireEqual(job[forbidden], undefined, `no job ${forbidden}`);
    }
    assertNoExecutableEnvironment(job, 'the coverage job', SEMANTIC_REVIEW_COVERAGE_ANNOTATE_STEP);
    const steps = stepsOf(job);
    assertNoShellOverride(steps, 'every coverage-job step');
    requireEqual(
        steps.map((step) => step.name),
        [...SEMANTIC_REVIEW_COVERAGE_STEPS],
        'its complete ordered steps'
    );
    requireEqual(
        steps.map((step) => step.uses).filter((uses) => uses !== undefined),
        [SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_ACTION],
        'the one pinned action, and no checkout'
    );
    const download = stepNamed(steps, SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_STEP);
    requireEqual(download.id, SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_STEP_ID, 'the outcome id the annotating step reads');
    requireEqual(download.with, SEMANTIC_REVIEW_COVERAGE_DOWNLOAD_INPUTS, 'the artifact this run uploaded');
    // The fetch is the one step whose failure is expected — the assessment job uploads an artifact
    // only when it delivered a report — so it is softened and the annotating step reports the gap.
    requireEqual(download['continue-on-error'], true, 'the softened artifact fetch');
    requireEqual(download.if, undefined, 'no condition on the artifact fetch');
    const annotate = stepNamed(steps, SEMANTIC_REVIEW_COVERAGE_ANNOTATE_STEP);
    // The one step environment this job may hold: the fetch's outcome and the coverage line, which
    // together tell a failed retrieval from a run that never published. Pinned whole, so a third
    // variable cannot join them.
    requireEqual(annotate.env, SEMANTIC_REVIEW_COVERAGE_ANNOTATE_ENV, 'the retrieval outcome and coverage line alone');
    requireEqual(
        named(annotate.run, `${SEMANTIC_REVIEW_COVERAGE_ANNOTATE_STEP} run`).trim(),
        SEMANTIC_REVIEW_COVERAGE_ANNOTATE_COMMAND,
        'exactly the pinned annotating command'
    );
    requireEqual(annotate.if, undefined, 'no condition on the annotating step');
    requireEqual(annotate['continue-on-error'], undefined, 'failure propagation');
}

export function assertSemanticReviewWorkflow(value: unknown): void {
    const workflow = asRecord(value, SEMANTIC_REVIEW_WORKFLOW_FILE);
    const triggers = asRecord(workflow.on, `${SEMANTIC_REVIEW_WORKFLOW_FILE} triggers`);
    requireEqual(
        Object.keys(triggers).sort(),
        [...SEMANTIC_REVIEW_TRIGGERS].sort(),
        'the privileged pull-request-target trigger and manual dispatch, and nothing else'
    );
    requireEqual(
        asRecord(triggers.pull_request_target, 'pull_request_target trigger').types,
        [...SEMANTIC_REVIEW_TARGET_TYPES],
        'its reviewed activity types'
    );
    requireEqual(workflow.permissions, SEMANTIC_REVIEW_PERMISSIONS, 'read-only repository permissions');
    // A workflow-level `defaults.run.shell` would replace the shell of every `run` step in both jobs,
    // which no command pin reads.
    requireNoDeclaration(workflow.defaults, 'no workflow-level defaults');
    requireEqual(
        workflow.concurrency,
        {
            group: 'semantic-review-${{ github.event.pull_request.number || inputs.pr }}',
            'cancel-in-progress': true,
        },
        'per-pull-request concurrency'
    );

    const jobs = asRecord(workflow.jobs, `${SEMANTIC_REVIEW_WORKFLOW_FILE} jobs`);
    requireEqual(Object.keys(jobs), [SEMANTIC_REVIEW_ASSESS_JOB, SEMANTIC_REVIEW_COVERAGE_JOB], 'its two jobs');
    const job = asRecord(jobs[SEMANTIC_REVIEW_ASSESS_JOB], 'semantic review job');
    requireEqual(job.name, SEMANTIC_REVIEW_CHECK_NAME, 'its distinct advisory check name');
    requireEqual(
        job.if,
        SEMANTIC_REVIEW_ELIGIBILITY_CONDITION,
        'its fork, draft, and default-branch eligibility condition'
    );
    requireEqual(job['runs-on'], 'ubuntu-latest', 'a standard hosted runner');
    for (const forbidden of ['permissions', 'continue-on-error', 'environment', 'uses', 'secrets']) {
        requireEqual(job[forbidden], undefined, `no job ${forbidden}`);
    }
    // The one output the coverage job's name is built from, and it is the bare step output: a job
    // that never ran never evaluates its outputs mapping, so the fallback belongs in the consumer's
    // name expression, where it is the expression that actually runs on the skipped and red paths.
    requireEqual(
        job.outputs,
        {
            [SEMANTIC_REVIEW_COVERAGE_OUTPUT]: '${{ steps.coverage.outputs.coverage }}',
        },
        'its single coverage output'
    );
    requireEqual(
        stepsOf(job).map((step) => step.name),
        [...SEMANTIC_REVIEW_STEPS],
        'its complete ordered steps'
    );
    requireEqual(
        stepsOf(job)
            .map((step) => step.uses)
            .filter((uses) => uses !== undefined),
        [...SEMANTIC_REVIEW_ACTIONS],
        'its pinned actions and no others'
    );
    // The upload's own inputs are pinned here, and its artifact name is the same constant the
    // download reads: the two sides cannot drift apart with only the regenerable snapshot catching it.
    const upload = stepNamed(stepsOf(job), SEMANTIC_REVIEW_UPLOAD_STEP);
    requireEqual(upload.uses, SEMANTIC_REVIEW_UPLOAD_ACTION, 'the pinned artifact uploader');
    requireEqual(upload.with, SEMANTIC_REVIEW_UPLOAD_INPUTS, 'the artifact this run publishes');
    requireEqual(upload.if, undefined, 'no condition on the artifact upload');
    // The setup actions' inputs decide what the pinned commands run on, and nothing else reads them.
    requireEqual(
        stepNamed(stepsOf(job), 'Set up Node').with,
        SEMANTIC_REVIEW_NODE_SETUP_INPUTS,
        'the Node version the assessment runs on'
    );
    requireEqual(stepNamed(stepsOf(job), 'Set up pnpm').with, undefined, 'no inputs on the pnpm setup step');
    assertNoShellOverride(stepsOf(job), 'every assessment-job step');
    for (const step of stepsOf(job)) {
        requireEqual(step['continue-on-error'], undefined, 'failure propagation');
        // Every step keeps the default success gate. The computing step in particular must not run
        // after a failed report: the line it would write would describe a report the upload step
        // never published, and the coverage job could then only disagree with the name it was given.
        requireEqual(step.if, undefined, 'no step condition beyond the job gate');
    }
    const coverageStep = stepNamed(stepsOf(job), SEMANTIC_REVIEW_COVERAGE_STEP);
    requireEqual(coverageStep.id, SEMANTIC_REVIEW_COVERAGE_STEP_ID, 'the output id its own output is read from');

    assertTrustedCheckout(job);
    assertEveryRunIsPinned(job);
    // The credential and head assertions run first so their specific refusals win; the environment
    // refusal then closes what none of them reads. The assessment step's environment is pinned whole
    // by `assertKeyIsScopedToTheAssessment`, the coverage annotating step's by `assertCoverageJob`;
    // every other step must carry none, or a `BASH_ENV` reaches a pinned command.
    assertKeyIsScopedToTheAssessment(workflow, job);
    // The workflow environment is pinned after the credential count, so a secret smuggled into it is
    // still refused by the specific message that names the credential, and any other entry set is
    // refused here. Comparison is order-insensitive: reordering the same three entries changes
    // nothing, while a fourth entry does. A workflow-level `defaults.run.shell` is refused above.
    if (!isSameKeyValueSet(workflow.env, SEMANTIC_REVIEW_ENV)) {
        throw new Error('Advisory semantic review workflow must retain its pinned workflow environment');
    }
    assertHeadIsNeverCheckedOut(workflow, job);
    assertNoExecutableEnvironment(job, 'the assessment job', SEMANTIC_REVIEW_ASSESS_STEP);
    assertCoverageJob(jobs);
}
