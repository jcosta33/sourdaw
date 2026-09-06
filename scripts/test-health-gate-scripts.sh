#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/sourdaw-health-gates.XXXXXX")
temp_root=$(CDPATH= cd "$temp_root" && pwd -P)
fake_bin="$temp_root/bin"

cleanup() {
    rm -rf "$temp_root"
}
trap cleanup 0
trap 'exit 1' 1 2 15

mkdir -p \
    "$fake_bin" \
    "$temp_root/scripts" \
    "$temp_root/server" \
    "$temp_root/trusted-scanner/scripts" \
    "$temp_root/scan-target/scripts" \
    "$temp_root/scan-target/.git" \
    "$temp_root/workflow-runner"
cp "$repo_root/scripts/health-gates-server.sh" "$temp_root/scripts/health-gates-server.sh"
cp "$repo_root/scripts/run-gitleaks-history-scan.sh" "$temp_root/scripts/run-gitleaks-history-scan.sh"
cp "$repo_root/scripts/assert-deployment-isolation.sh" "$temp_root/scripts/assert-deployment-isolation.sh"
cp "$repo_root/.gitleaks.toml" "$temp_root/.gitleaks.toml"
cp "$repo_root/.gitleaksignore" "$temp_root/.gitleaksignore"
cp "$repo_root/scripts/run-gitleaks-history-scan.sh" "$temp_root/trusted-scanner/scripts/run-gitleaks-history-scan.sh"
cp "$repo_root/.gitleaks.toml" "$temp_root/trusted-scanner/.gitleaks.toml"
cp "$repo_root/.gitleaksignore" "$temp_root/trusted-scanner/.gitleaksignore"
cat > "$temp_root/scan-target/scripts/run-gitleaks-history-scan.sh" <<'SH'
#!/bin/sh
set -eu
printf 'PR-owned helper invoked\n' >> "$MALICIOUS_HELPER_MARKER"
exit "${GITLEAKS_EXIT_CODE:-0}"
SH
chmod +x "$temp_root/scan-target/scripts/run-gitleaks-history-scan.sh"
printf '[allowlist]\npaths = [".*"]\n' > "$temp_root/scan-target/.gitleaks.toml"
printf '*\n' > "$temp_root/scan-target/.gitleaksignore"

printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "pnpm %s\n" "$*" >> "$COMMAND_LOG"' \
    'if [ "${1:-}" = "lint:full" ]; then' \
    '    exit "${FAKE_LINT_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:collection-scope" ]; then' \
    '    exit "${FAKE_COLLECTION_SCOPE_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:command-schema" ]; then' \
    '    exit "${FAKE_COMMAND_SCHEMA_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:release-inventory" ]; then' \
    '    exit "${FAKE_RELEASE_INVENTORY_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:barrel-mocks" ]; then' \
    '    exit "${FAKE_BARREL_MOCKS_STATUS:-0}"' \
    'fi' \
    > "$fake_bin/pnpm"
printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "npm %s\n" "$*" >> "$COMMAND_LOG"' \
    'if [ "${FAKE_SERVER_DEPS:-ready}" = "missing" ] && [ "${3:-}" = "ls" ]; then' \
    '    exit 1' \
    'fi' \
    'if [ "${NODE_ENV:-}" = "production" ] && [ "${3:-}" = "ls" ]; then' \
    '    case " $* " in *" --include=dev "*) ;; *) exit 42 ;; esac' \
    'fi' \
    'if [ "${1:-}" = "test" ]; then' \
    '    exit "${FAKE_SERVER_TEST_STATUS:-0}"' \
    'fi' \
    > "$fake_bin/npm"
printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "cargo %s\n" "$*" >> "$COMMAND_LOG"' \
    'case "${1:-}" in' \
    '    clippy) exit "${FAKE_CARGO_CLIPPY_STATUS:-0}" ;;' \
    '    test) exit "${FAKE_CARGO_TEST_STATUS:-0}" ;;' \
    'esac' \
    > "$fake_bin/cargo"
cat > "$fake_bin/curl" <<'SH'
#!/bin/sh
set -eu
printf 'curl %s\n' "$*" >> "$COMMAND_LOG"
output=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output)
            shift
            output=$1
            ;;
    esac
    shift
done
test -n "$output"
printf 'fake gitleaks archive\n' > "$output"
SH
cat > "$fake_bin/sha256sum" <<'SH'
#!/bin/sh
set -eu
printf 'sha256sum %s\n' "$*" >> "$COMMAND_LOG"
if IFS= read -r digest_line; then
    printf 'sha256sum stdin: %s\n' "$digest_line" >> "$COMMAND_LOG"
fi
exit "${FAKE_SHA256SUM_STATUS:-0}"
SH
cat > "$fake_bin/tar" <<'SH'
#!/bin/sh
set -eu
printf 'tar %s\n' "$*" >> "$COMMAND_LOG"
extract_dir=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -C)
            shift
            extract_dir=$1
            ;;
    esac
    shift
done
test -n "$extract_dir"
mkdir -p "$extract_dir"
cat > "$extract_dir/gitleaks" <<'GITLEAKS'
#!/bin/sh
set -eu
printf 'gitleaks %s\n' "$*" >> "$COMMAND_LOG"
exit "${FAKE_GITLEAKS_STATUS:-0}"
GITLEAKS
chmod +x "$extract_dir/gitleaks"
SH
chmod +x "$fake_bin/pnpm" "$fake_bin/npm" "$fake_bin/cargo" "$fake_bin/curl" "$fake_bin/sha256sum" "$fake_bin/tar"
cat > "$fake_bin/gh" <<'SH'
#!/bin/sh
set -eu

printf '%s' "$*" | tr '\n' ' ' >> "$GH_ISSUE_LOG"
printf '\n' >> "$GH_ISSUE_LOG"
repo=
expect_repo=false
for argument in "$@"; do
    if [ "$expect_repo" = true ]; then
        repo=$argument
        expect_repo=false
    elif [ "$argument" = --repo ]; then
        expect_repo=true
    fi
done
if [ "$repo" != "$GITHUB_REPOSITORY" ]; then
    printf 'gh issue command must pass --repo %s\n' "$GITHUB_REPOSITORY" >&2
    exit 24
fi

case "${GH_ISSUE_MODE}:${1:-}:${2:-}" in
    existing:issue:list) printf '42\n' ;;
    existing:issue:comment) ;;
    none:issue:list) ;;
    none:issue:create) ;;
    *) exit 23 ;;
esac
SH
chmod +x "$fake_bin/gh"

WORKFLOW_PATH="$repo_root/.github/workflows/health-gates.yml" VALIDATION_WORKFLOW_PATH="$repo_root/.github/workflows/validation.yml" HEAVY_WORKFLOW_PATH="$repo_root/.github/workflows/heavy-gates.yml" NIGHTLY_PATH="$repo_root/.github/workflows/nightly.yml" REPO_ROOT="$repo_root" TEST_TEMP_ROOT="$temp_root" FAKE_BIN="$fake_bin" pnpm exec tsx --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

// Three files rather than one, and the split is the security boundary rather
// than an organising preference. `Gate` is a required status check, GitHub
// counts a `skipped` conclusion as satisfying one, and it prefers the newest
// run of that name — so any event that can reach the file holding `gate` and
// legitimately skip it can mint a passing `Gate` over a red head. Only
// `pull_request` reaches `health-gates.yml`, and `gate` cannot skip there.
const { assertDeployWebBuildRun, assertDeployWebJobNoVercelPull } = await import(
    `${process.env.REPO_ROOT}/scripts/deployWebWorkflowContract.ts`
);
// The structural pins live in one shared module so this harness and the
// vitest spec can never drift apart: the whole-file snapshot, the shard
// matrices, the permission-free files, and every job's step inventory.
const {
    assertWorkflowFileInventory,
    assertWorkflowSnapshotMatch,
    JOB_LEVEL_PERMISSION_FREE_FILES,
    parseHealthGateWorkflows,
    readRecordedWorkflowSnapshot,
    SHARD_MATRIX_JOBS,
    STEP_INVENTORY,
} = await import(`${process.env.REPO_ROOT}/scripts/healthGateWorkflowContract.ts`);
const workflow = parse(readFileSync(process.env.WORKFLOW_PATH, 'utf8'));
const validationWorkflow = parse(readFileSync(process.env.VALIDATION_WORKFLOW_PATH, 'utf8'));
const heavyWorkflow = parse(readFileSync(process.env.HEAVY_WORKFLOW_PATH, 'utf8'));
const nightly = parse(readFileSync(process.env.NIGHTLY_PATH, 'utf8'));
const gitleaksHelper = readFileSync(`${process.env.REPO_ROOT}/scripts/run-gitleaks-history-scan.sh`, 'utf8');
const gitleaksConfig = readFileSync(`${process.env.REPO_ROOT}/.gitleaks.toml`, 'utf8');
const gitleaksIgnore = readFileSync(`${process.env.REPO_ROOT}/.gitleaksignore`, 'utf8');
const failures = [];

function expect(condition, message) {
    if (!condition) {
        failures.push(message);
    }
}

expect(
    gitleaksIgnore ===
        'd0778b1ccdc63a5734b5815b682c9ff1a1ac10bc:scripts/__tests__/resolveReviewThread.spec.ts:generic-api-key:3288\n' +
            'd0778b1ccdc63a5734b5815b682c9ff1a1ac10bc:scripts/__tests__/resolveReviewThread.spec.ts:generic-api-key:3355\n',
    '.gitleaksignore must contain exactly the two approved resolver-test fingerprints'
);

function expectNightlyDoesNotMintGate(jobs) {
    expect(jobs?.gate === undefined, 'nightly must not mint Gate');
    for (const [jobId, job] of Object.entries(jobs ?? {})) {
        const checkName = typeof job?.name === 'string' ? job.name : jobId;
        if (checkName === 'Gate') {
            expect(false, `nightly job ${jobId} must not mint Gate`);
        }
    }
}


function stepNamed(job, name) {
    return job?.steps?.find((step) => step.name === name);
}

function assertNightlyPnpmBeforeNodeOrder(jobs) {
    for (const [jobId, job] of Object.entries(jobs ?? {})) {
        const steps = job?.steps ?? [];
        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];
            if (step?.name !== 'Set up Node' || step?.with?.cache !== 'pnpm') {
                continue;
            }
            expect(
                steps[index - 1]?.name === 'Set up pnpm',
                `${jobId} must run Set up pnpm immediately before Set up Node when setup-node caches pnpm`
            );
        }
    }
}

function runResolveScope(event, scopes) {
    const outputPath = `${process.env.TEST_TEMP_ROOT}/resolve-scope-${event}.output`;
    writeFileSync(outputPath, '');
    const result = spawnSync('bash', ['-c', resolveScopeRun], {
        encoding: 'utf8',
        env: {
            ...process.env,
            EVENT: event,
            RUST: scopes.rust,
            SERVER: scopes.server,
            E2E: scopes.e2e,
            WEB: scopes.web,
            UNCLASSIFIED: scopes.unclassified ?? 'false',
            GITHUB_OUTPUT: outputPath,
        },
    });
    expect(result.status === 0, `Resolve scope must execute for ${event}: ${result.stderr.trim()}`);
    return readFileSync(outputPath, 'utf8');
}

function runWorkflowShell(label, body, env) {
    const result = spawnSync('bash', ['-c', body], {
        cwd: process.env.TEST_TEMP_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    expect(result.status === 0, `${label} must execute outside the scan target: ${result.stderr.trim()}`);
    return result;
}

function workflowShellStatus(body, env) {
    return spawnSync('bash', ['-c', body], {
        cwd: process.env.TEST_TEMP_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    }).status;
}

function expectShardFailureWarning(step, slug, suite, shard) {
    const summaryPath = `${process.env.TEST_TEMP_ROOT}/${slug}-shard-summary.md`;
    writeFileSync(summaryPath, '');
    expect(step?.env?.SHARD === '${{ matrix.shard }}', `${suite} warning must receive the matrix shard`);
    const result = runWorkflowShell(`${suite} warning`, step?.run ?? '', {
        GITHUB_STEP_SUMMARY: summaryPath,
        SHARD: shard,
    });
    expect(
        result.stdout === `::warning title=${suite} shard failed::Shard ${shard} failed; inspect the Run shard log.\n`,
        `${suite} warning must emit the exact shard annotation`
    );
    expect(
        readFileSync(summaryPath, 'utf8') ===
            `### ${suite} shard ${shard} failed\n\nInspect the \`Run shard\` step log for raw failure output.\n`,
        `${suite} warning must write the exact shard summary`
    );
}

const events = workflow.on;
const validationEvents = validationWorkflow.on;
const heavyEvents = heavyWorkflow.on;
const concurrency = workflow.concurrency;
// The validation lane is one definition called from both workflows, so its jobs
// are read from that file rather than from either caller.
const decide = validationWorkflow.jobs?.decide;
const staticJob = validationWorkflow.jobs?.static;
const lint = validationWorkflow.jobs?.lint;
const boundaries = validationWorkflow.jobs?.boundaries;
const smoke = validationWorkflow.jobs?.smoke;
const prSecrets = validationWorkflow.jobs?.['pr-secrets'];
const prSecretsTrustedCheckout = stepNamed(prSecrets, 'Checkout trusted scanner');
const prSecretsTargetCheckout = stepNamed(prSecrets, 'Checkout scan target');
const prSecretsScanRun = stepNamed(prSecrets, 'Scan pull request diff for secrets')?.run ?? '';
const prMergeControl = stepNamed(prSecrets, 'Validate PR merge diff secret scanner');
const prMergeControlRun = prMergeControl?.run ?? '';
const TOKEN_PATTERN = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./iu;
const secrets = heavyWorkflow.jobs?.secrets;
const heavyCodeql = heavyWorkflow.jobs?.codeql;
const unit = validationWorkflow.jobs?.unit;
const e2e = heavyWorkflow.jobs?.e2e;
const nightlyUnit = nightly.jobs?.unit;
const nightlyE2e = nightly.jobs?.e2e;
const nightlySecrets = nightly.jobs?.secrets;
const gate = workflow.jobs?.gate;
const heavyGate = heavyWorkflow.jobs?.['heavy-gate'];
const dependencyReview = validationWorkflow.jobs?.['dependency-review'];
const dependencyReviewWith = stepNamed(dependencyReview, 'Review dependency changes')?.with ?? {};
const browserAiWebGpu = heavyWorkflow.jobs?.['browser-ai-webgpu'];
const nightlyReport = nightly.jobs?.['nightly-report'];
const resolveScopeRun = stepNamed(decide, 'Resolve scope')?.run ?? '';
const nightlyResolveScopeRun = stepNamed(nightly.jobs?.decide, 'Resolve scope')?.run ?? '';
const nightlyStaticCheckoutUses = stepNamed(nightly.jobs?.static, 'Checkout')?.uses ?? '';
const trustedCheckout = stepNamed(secrets, 'Checkout trusted scanner');
const targetCheckout = stepNamed(secrets, 'Checkout scan target');
const positiveControl = stepNamed(secrets, 'Validate secret scanner positive control');
const positiveControlRun = positiveControl?.run ?? '';
const secretScan = stepNamed(secrets, 'Scan history for secrets');
const secretScanRun = secretScan?.run ?? '';
const secretScanUses = secretScan?.uses ?? '';
const secretsEnv = secrets?.env ?? {};
const secretScanEnvJson = JSON.stringify([secretsEnv, positiveControl?.env ?? {}, secretScan?.env ?? {}]);
const unitRunStep = stepNamed(unit, 'Run shard');
const e2eRunStep = stepNamed(e2e, 'Run shard');
const unitFailureWarning = stepNamed(unit, 'Report shard failure');
const e2eFailureWarning = stepNamed(e2e, 'Report shard failure');
const unitRun = unitRunStep?.run ?? '';
const nightlyReportCheckout = stepNamed(nightlyReport, 'Checkout');
const nightlyReportStep = stepNamed(nightlyReport, 'Open or update the nightly failure issue');
const nightlyReportRun = nightlyReportStep?.run ?? '';
const gateRun = stepNamed(gate, 'Require every job to have succeeded or been skipped')?.run ?? '';
const heavyGateRun = stepNamed(heavyGate, 'Require every job to have succeeded or been skipped')?.run ?? '';
const gateNeeds = gate?.needs ?? [];
// One entry, because the validation lane is one reusable workflow now. A
// `uses:` job reports failure when any job inside it failed, so the summary is
// no weaker for being shorter — and `expectedValidationJobs` below is what
// keeps a leg from being dropped out of the lane unnoticed.
const expectedGateNeeds = ['validation'];
const expectedValidationJobs = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'unit',
    'smoke',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'native-parity',
    'dependency-review',
    'pr-secrets',
];
const expectedHeavyGateNeeds = ['validation', 'e2e', 'browser-ai-webgpu', 'codeql', 'secrets'];

expect(workflow.name === 'Health gates', 'workflow name must stay Health gates');
// The central invariant of the split. GitHub counts a check run whose
// conclusion is `skipped` as satisfying a required status check, and prefers
// the newest run of that name, so an event that can reach `gate` and skip it
// mints a passing `Gate` over a red head. A `pull_request_review` trigger did
// exactly that in production. `pull_request` is the only event here, and it can
// never skip `gate`.
expect(
    JSON.stringify(Object.keys(events ?? {})) === JSON.stringify(['pull_request']),
    'health-gates.yml must answer to pull_request alone, because any other event can skip Gate and a skipped Gate satisfies the required check'
);
expect(gate?.if === '${{ !cancelled() }}', 'Gate must carry no predicate that could skip it and mint a passing required check');
// The heavy lane owns the review event that was removed above, and mints its
// own differently-named summary so no skip of it can ever satisfy `Gate`. The
// schedule and dispatch events live in `nightly.yml`, pinned further below.
expect(heavyWorkflow.name === 'Heavy gates', 'heavy workflow name must stay Heavy gates');
expect(
    JSON.stringify(Object.keys(heavyEvents ?? {}).sort()) === JSON.stringify(['pull_request_review']),
    'the heavy workflow must own exactly the review event that health-gates.yml gave up; the schedule and dispatch events live in nightly.yml'
);
expect(
    heavyEvents?.pull_request_review?.types?.includes('submitted'),
    'pull_request_review submitted must trigger the heavy workflow'
);
expect(heavyEvents?.pull_request === undefined, 'the heavy workflow must not run on a pull-request push');
expect(
    nightly.on?.schedule?.[0]?.cron === '23 3 * * *',
    'the nightly cron must survive the move of the schedule event to nightly.yml'
);
// `Gate` is the required context. Only health-gates.yml may mint it, so no job
// anywhere else may carry that name — a same-named check run from another
// workflow competes for the required context.
function gateNameViolations(file, jobs) {
    const violations = [];
    for (const [id, job] of Object.entries(jobs ?? {})) {
        if ((job?.name ?? id) === 'Gate') {
            violations.push(
                `${file} job ${id} must not be named Gate; only a pull_request run of health-gates.yml may mint that check`
            );
        }
    }
    return violations;
}
for (const [file, parsed] of [['validation.yml', validationWorkflow], ['heavy-gates.yml', heavyWorkflow]]) {
    for (const violation of gateNameViolations(file, parsed.jobs ?? {})) {
        expect(false, violation);
    }
}
// GitHub names an unnamed job's check run after its job id, so an unnamed
// Gate-keyed job mints the required context too. The guard must read the id
// as the name, and this mutant proves it does.
expect(
    gateNameViolations('mutant.yml', { Gate: { needs: ['decide'] } }).length === 1,
    'the Gate-name guard must catch an unnamed Gate-keyed job'
);
expect(heavyGate?.name === 'HeavyGate', 'the heavy summary must keep its own distinct, non-required name');
expect(
    JSON.stringify(heavyGate?.needs ?? []) === JSON.stringify(expectedHeavyGateNeeds),
    `HeavyGate needs must stay exactly: ${expectedHeavyGateNeeds.join(', ')}`
);
// The shared lane is a reusable workflow and nothing else: a second trigger
// would let it mint its own check runs beside the callers'.
expect(validationWorkflow.name === 'Validation', 'validation workflow name must stay Validation');
expect(
    JSON.stringify(Object.keys(validationEvents ?? {})) === JSON.stringify(['workflow_call']),
    'validation.yml must be reusable-only, so it runs exactly once per caller run and never on its own'
);
expect(
    JSON.stringify(Object.keys(validationWorkflow.jobs ?? {})) === JSON.stringify(expectedValidationJobs),
    `validation.yml must hold exactly these jobs, in order: ${expectedValidationJobs.join(', ')}`
);
// The decide outputs reach callers only through this export list: deleting one
// leaves `needs.validation.outputs.<name>` empty while the decide pins stay
// green, which is how the approved-review heavy lane could skip under a green
// HeavyGate.
expect(
    JSON.stringify(Object.keys(validationEvents?.workflow_call?.outputs ?? {}).sort()) ===
        JSON.stringify(['code', 'e2e', 'heavy', 'rust', 'server', 'web']),
    'validation.yml must export exactly the six scope outputs to its callers'
);
for (const exportName of ['heavy', 'rust', 'server', 'e2e', 'web', 'code']) {
    expect(
        validationEvents?.workflow_call?.outputs?.[exportName]?.value === `\${{ jobs.decide.outputs.${exportName} }}`,
        `the ${exportName} caller output must forward jobs.decide.outputs.${exportName}`
    );
}
for (const [file, parsed] of [['health-gates.yml', workflow], ['heavy-gates.yml', heavyWorkflow]]) {
    expect(
        parsed.jobs?.validation?.uses === './.github/workflows/validation.yml',
        `${file} must call the shared validation lane rather than redefine it`
    );
}
expect(
    heavyWorkflow.jobs?.validation?.if === "github.event.review.state == 'approved'",
    'the heavy validation lane must refuse non-approved reviews, which may mint no green verdict on the head'
);
expect(
    workflow.jobs?.validation?.if === undefined,
    'the health validation lane must run on every pull request'
);
expect(
    concurrency?.group === 'health-gates-${{ github.event.pull_request.number }}',
    'pull-request validation must group by pull request'
);
expect(
    heavyWorkflow.concurrency?.group ===
        "heavy-gates-${{ (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') && github.event.pull_request.number || github.run_id }}",
    'the heavy lane must group approving reviews by pull request and everything else by run id'
);
expect(
    heavyWorkflow.concurrency?.['cancel-in-progress'] === false,
    'the heavy lane must never cancel: an approving review run is the only run that observes those legs on that head'
);
// A job-level `concurrency` is its own group, independent of the
// workflow-level one: a constant group with cancellation on a matrix job
// would let queued shards cancel in-progress ones. Nightly is swept with the
// rest; its deploy-web job is the single allowlisted exception, and that
// block stays pinned below.
for (const [file, parsed, exempt] of [
    ['health-gates.yml', workflow],
    ['validation.yml', validationWorkflow],
    ['heavy-gates.yml', heavyWorkflow],
    ['nightly.yml', nightly, 'deploy-web'],
]) {
    for (const [id, job] of Object.entries(parsed.jobs ?? {})) {
        if (id === exempt) {
            continue;
        }
        expect(
            job?.concurrency === undefined,
            `${file} job ${id} must not carry job-level concurrency; the workflow-level group is the only serialization`
        );
    }
}
expect(
    concurrency?.['cancel-in-progress'] === true,
    'a newer pull_request run must cancel in-progress validation of the same PR'
);
expect(
    decide?.if === "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'",
    'decide must run the heavy path only for approved pull_request_review submissions'
);
expect(nightly.name === 'Nightly', 'nightly workflow name must stay Nightly');
expect(
    Object.keys(nightly.on ?? {}).sort().join('\0') === 'schedule\0workflow_dispatch',
    'Nightly on must be exactly schedule and workflow_dispatch'
);
expectNightlyDoesNotMintGate(nightly.jobs);
assertNightlyPnpmBeforeNodeOrder(nightly.jobs);
expect(
    nightly.concurrency?.group === 'nightly-${{ github.run_id }}',
    'nightly must isolate each run on its own run id'
);
expect(nightly.concurrency?.['cancel-in-progress'] === false, 'nightly must not cancel an in-progress train');
expect(workflow.jobs?.['deploy-web'] === undefined, 'the pull-request workflow must not deploy');
expect(workflow.jobs?.e2e === undefined, 'the pull-request workflow must not run the end-to-end suite');
const allFalseScopes = { rust: 'false', server: 'false', e2e: 'false', web: 'false' };
const reviewScopes = { rust: 'false', server: 'true', e2e: 'false', web: 'true' };
const pullRequestScopes = { rust: 'true', server: 'false', e2e: 'true', web: 'false' };
const unclassifiedScopes = { ...allFalseScopes, unclassified: 'true' };
function runNightlyResolveScope(event) {
    const outputPath = `${process.env.TEST_TEMP_ROOT}/resolve-scope-nightly-${event}.output`;
    writeFileSync(outputPath, '');
    const result = spawnSync('bash', ['-c', nightlyResolveScopeRun], {
        encoding: 'utf8',
        env: { ...process.env, EVENT: event, GITHUB_OUTPUT: outputPath },
    });
    expect(result.status === 0, `Nightly resolve scope must execute for ${event}: ${result.stderr.trim()}`);
    return readFileSync(outputPath, 'utf8');
}
// The schedule and dispatch events belong to the nightly alone, so the
// all-scopes probes run its script; validation.yml answers workflow_call only.
for (const eventName of ['schedule', 'workflow_dispatch']) {
    expect(
        runNightlyResolveScope(eventName) === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\ncode=true\n',
        `nightly must enable the heavy path and every scope on ${eventName}`
    );
}
expect(
    runResolveScope('pull_request_review', reviewScopes) === 'heavy=true\nrust=false\nserver=true\ne2e=false\nweb=true\ncode=true\n',
    'pull_request_review must enable the heavy path and preserve path-filter outputs'
);
expect(
    runResolveScope('pull_request', pullRequestScopes) === 'heavy=false\nrust=true\nserver=false\ne2e=true\nweb=false\ncode=true\n',
    'pull_request must disable the heavy path and preserve path-filter outputs'
);
expect(
    runResolveScope('pull_request', allFalseScopes) === 'heavy=false\nrust=false\nserver=false\ne2e=false\nweb=false\ncode=false\n',
    'a head that claims no scope must report no code-bearing change'
);
expect(
    runResolveScope('pull_request', unclassifiedScopes) === 'heavy=false\nrust=true\nserver=true\ne2e=true\nweb=true\ncode=true\n',
    'an unclassified path must force every fast scope rather than skipping the checks that would observe it'
);
expect(
    lint?.if === "needs.decide.outputs.code == 'true'" && boundaries?.if === "needs.decide.outputs.code == 'true'",
    'lint and boundaries must skip a head that carries only prose'
);
expect(staticJob?.if === undefined, 'static must stay unconditional so release inventory observes prose changes too');
// The four scope conditions no other pin reads. Each is the whole definition
// of when its job may legitimately skip: widening one runs the leg where it
// proves nothing, and narrowing or dropping one retires the proof while every
// other pin stays green.
expect(
    validationWorkflow.jobs?.build?.if === "needs.decide.outputs.web == 'true'",
    'the production build must answer to the web scope alone'
);
expect(
    validationWorkflow.jobs?.rust?.if === "needs.decide.outputs.rust == 'true' || needs.decide.outputs.server == 'true'",
    'the Rust workspace leg must answer to the Rust and server scopes'
);
expect(
    validationWorkflow.jobs?.['native-macos']?.if === "needs.decide.outputs.rust == 'true'",
    'the native macOS leg must answer to the Rust scope alone'
);
expect(
    validationWorkflow.jobs?.['native-windows']?.if === "needs.decide.outputs.rust == 'true'",
    'the native Windows leg must answer to the Rust scope alone'
);
const deviceWriteBoundaryCensusRun =
    'pnpm test:run src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts';
expect(
    stepNamed(staticJob, 'Device write boundary census')?.run === deviceWriteBoundaryCensusRun,
    'static must run the device write boundary census outside unit shards'
);
expect(
    stepNamed(staticJob, 'Device write boundary census')?.['continue-on-error'] === undefined,
    'static device write boundary census must not continue on error'
);
expect(
    stepNamed(staticJob, 'Device write boundary census')?.if === undefined,
    'static device write boundary census must stay unconditional'
);
expect(
    stepNamed(nightly.jobs?.static, 'Device write boundary census')?.run === deviceWriteBoundaryCensusRun,
    'nightly static must run the device write boundary census outside unit shards'
);
expect(
    stepNamed(nightly.jobs?.static, 'Device write boundary census')?.['continue-on-error'] === undefined,
    'nightly static device write boundary census must not continue on error'
);
expect(
    stepNamed(nightly.jobs?.static, 'Device write boundary census')?.if === undefined,
    'nightly static device write boundary census must stay unconditional'
);
const releaseProofRun = 'pnpm test:run scripts/__tests__/releaseProof.spec.ts';
expect(
    stepNamed(staticJob, 'Release proof')?.run === releaseProofRun,
    'static must run the release proof spec outside unit shards'
);
expect(
    stepNamed(staticJob, 'Release proof')?.['continue-on-error'] === undefined,
    'static Release proof must stay blocking'
);
expect(
    stepNamed(nightly.jobs?.static, 'Release proof')?.run === releaseProofRun,
    'nightly static must run the release proof spec outside unit shards'
);
expect(
    stepNamed(nightly.jobs?.static, 'Release proof')?.['continue-on-error'] === undefined,
    'nightly static Release proof must stay blocking'
);
expect(
    smoke?.if === "github.event.pull_request != null && needs.decide.outputs.e2e == 'true'",
    'the offline smoke set must run on every pull-request run that touches the browser surface, including the review run an approval leaves reporting'
);
expect(
    stepNamed(smoke, 'Run offline smoke set')?.run === 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0',
    'the offline smoke set must run without retries, which would hide a flake instead of reporting it'
);
expect(
    prSecrets?.if === 'github.event.pull_request != null',
    'the diff secret scan must run on every run carrying a pull request, including the review run an approval leaves reporting'
);
expect(
    !TOKEN_PATTERN.test(JSON.stringify(prSecrets)),
    'diff secret scan must not reference GitHub tokens or repository secrets'
);
expect(
    prSecretsTrustedCheckout?.with?.ref === '${{ github.event.pull_request.base.sha }}' &&
        prSecretsTrustedCheckout?.with?.['persist-credentials'] === false,
    'diff secret scan must read its config from the trusted base revision without persisting credentials'
);
// This job only ever runs on a head carrying a pull request, so its scan
// target pins the head SHA outright rather than the history job's fallback.
expect(
    prSecretsTargetCheckout?.with?.ref === '${{ github.event.pull_request.head.sha }}' &&
        prSecretsTargetCheckout?.with?.path === 'scan-target' &&
        prSecretsTargetCheckout?.with?.['fetch-depth'] === 0 &&
        prSecretsTargetCheckout?.with?.['persist-credentials'] === false,
    'diff secret scan target must retain the complete untrusted history without persisting credentials'
);
expect(
    prSecretsScanRun.includes('--log-opts="$BASE_SHA..$HEAD_SHA -m"'),
    'diff secret scan must scan the commits this head adds to its base, including merge resolutions'
);
expect(
    prSecretsScanRun.includes('--ignore-gitleaks-allow') && prSecretsScanRun.includes('--redact=100'),
    'diff secret scan must reject head-authored allow annotations and redact what it prints'
);
// The merge-diff control proves the scanner still detects, and still refuses
// head-authored suppression, on the path the diff scan actually takes. Each
// half is pinned separately so deleting one is a named failure rather than a
// control that silently stops controlling.
expect(
    prMergeControl?.env?.GITLEAKS_EXPECTED_LEAK_EXIT_CODE === 79,
    'merge-diff positive control must use a distinct expected leak exit code'
);
expect(
    prMergeControlRun.includes('mktemp -d "$RUNNER_TEMP/gitleaks-pr-merge-control.XXXXXX"'),
    'merge-diff positive control must use a temporary runner path'
);
expect(
    prMergeControlRun.includes("synthetic_access_key=$(printf '%s%s%s' 'AKIA' 'QAZ2WSX3' 'EDC4RFV5')"),
    'merge-diff positive control secret must be assembled at runtime'
);
expect(
    prMergeControlRun.includes('mkdir -p "$positive_control_repo/public/wasm"') &&
        prMergeControlRun.includes('aws_access_key_id = "%s" // gitleaks:allow') &&
        prMergeControlRun.includes('> "$positive_control_repo/public/wasm/fixture.js"'),
    'merge-diff positive control must place an annotated secret under a formerly excluded path'
);
expect(
    prMergeControlRun.includes('cat > "$positive_control_repo/.gitleaks.toml"') &&
        prMergeControlRun.includes('regexes = [\'\'\'.*\'\'\']') &&
        prMergeControlRun.includes('git -C "$positive_control_repo" add public/wasm/fixture.js .gitleaks.toml'),
    'merge-diff positive control must commit a target-root config that would suppress the synthetic secret if loaded'
);
expect(
    prMergeControlRun.includes('--config "$GITHUB_WORKSPACE/trusted-scanner/.gitleaks.toml"') &&
        prMergeControlRun.includes('--exit-code="$GITLEAKS_EXPECTED_LEAK_EXIT_CODE"') &&
        prMergeControlRun.includes('--log-opts="$base_sha..$head_sha -m"'),
    'merge-diff positive control must scan the merge diff with the trusted config and the distinct leak exit code'
);
expect(
    prMergeControlRun.includes('--ignore-gitleaks-allow'),
    'merge-diff positive control must reject head-authored allow annotations, which is the suppression it exists to defeat'
);
expect(
    prMergeControlRun.includes('positive_control_status') &&
        prMergeControlRun.includes('-ne "$GITLEAKS_EXPECTED_LEAK_EXIT_CODE"'),
    'merge-diff positive control must require the exact leak exit code'
);
expect(
    prMergeControl?.['working-directory'] === '${{ github.workspace }}',
    'merge-diff positive control must run outside the untrusted checkout'
);
expect(
    heavyCodeql?.if ===
        "needs.validation.outputs.heavy == 'true' && github.event.pull_request.head.repo.full_name == github.repository",
    'CodeQL must refuse fork pull requests, whose read-only token cannot write the SARIF result'
);
// The SARIF upload is the only write this job needs: `contents: write` would
// hand a review-triggered workflow a token that can push, and dropping
// `security-events: write` would fail the upload on the head.
expect(
    heavyCodeql?.permissions?.contents === 'read' &&
        heavyCodeql?.permissions?.['security-events'] === 'write' &&
        heavyCodeql?.permissions?.actions === 'read' &&
        Object.keys(heavyCodeql?.permissions ?? {}).length === 3,
    'the heavy CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
);
expect(secrets?.if === "needs.validation.outputs.heavy == 'true'", 'secrets job must remain on the heavy path');
expect(nightlySecrets?.if === "needs.decide.outputs.heavy == 'true'", 'nightly secrets job must remain on the heavy path');
expect(/^actions\/checkout@[0-9a-f]{40}$/u.test(trustedCheckout?.uses ?? ''), 'trusted scanner checkout action must be pinned to a full commit SHA');
expect(/^actions\/checkout@[0-9a-f]{40}$/u.test(targetCheckout?.uses ?? ''), 'scan target checkout action must be pinned to a full commit SHA');
expect(
    trustedCheckout?.with?.ref === '${{ github.event.pull_request.base.sha || github.sha }}',
    'trusted scanner must use the immutable pull request base SHA with the current event SHA fallback'
);
expect(trustedCheckout?.with?.path === 'trusted-scanner', 'trusted scanner must use its own checkout path');
expect(trustedCheckout?.with?.['persist-credentials'] === false, 'trusted scanner checkout must not persist credentials');
expect(
    targetCheckout?.with?.ref === '${{ github.event.pull_request.head.sha || github.sha }}',
    'scan target must use the immutable pull request head SHA with the current event SHA fallback'
);
expect(targetCheckout?.with?.path === 'scan-target', 'scan target must use its own checkout path');
expect(targetCheckout?.with?.['fetch-depth'] === 0, 'scan target checkout must fetch full history');
expect(targetCheckout?.with?.['persist-credentials'] === false, 'scan target checkout must not persist credentials');
expect(trustedCheckout?.with?.path !== targetCheckout?.with?.path, 'trusted scanner and scan target checkout paths must remain separate');
expect(secretScanUses === '', 'secret scan must not use gitleaks-action, which rejects pull_request_review events');
expect(secretsEnv.GITLEAKS_VERSION === '8.30.1', 'secret scan must pin the Gitleaks binary version');
expect(
    secretsEnv.GITLEAKS_SHA256 === '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    'secret scan must pin the Gitleaks binary SHA-256 digest'
);
expect(
    gitleaksHelper.includes(
        'https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz'
    ),
    'secret scan must download the pinned Gitleaks Linux x64 release binary'
);
expect(gitleaksHelper.includes('sha256sum --check --status'), 'secret scan must verify the downloaded Gitleaks binary digest');
expect(/"\$gitleaks_dir\/gitleaks" git/u.test(gitleaksHelper), 'secret scan must invoke the event-agnostic Gitleaks git scanner');
expect(
    gitleaksHelper.includes('gitleaks_config="$trusted_root/.gitleaks.toml"') &&
        gitleaksHelper.includes('--config "$gitleaks_config"'),
    'secret scan must force the trusted checkout config instead of loading target-controlled configuration'
);
expect(
    gitleaksHelper.includes('gitleaks_ignore="$trusted_root/.gitleaksignore"') &&
        gitleaksHelper.includes('--gitleaks-ignore-path "$gitleaks_ignore"'),
    'secret scan must force the trusted checkout ignore file instead of loading cwd-controlled ignore rules'
);
expect(gitleaksHelper.includes('--ignore-gitleaks-allow'), 'secret scan must reject PR-authored gitleaks:allow annotations');
expect(!/^\s*paths\s*=/mu.test(gitleaksConfig), 'trusted Gitleaks config must not contain path-wide allowlists');
const rfc4122ExampleUuid = ['123e4567', 'e89b', '12d3', 'a456', '426614174000'].join('-');
const rfc4122ExampleUuidSuccessor = ['123e4567', 'e89b', '12d3', 'a456', '426614174001'].join('-');
const reviewPublicationRecoveryUuid = ['2cd01237', 'cf63', '4579', '9e58', '85893794529d'].join('-');
const deliveryLockRecoveryUuid = ['f515a71d', 'c25a', '4714', 'b725', 'ef6e9b141005'].join('-');
const deliveryLockSecondRecoveryUuid = ['8cd2556c', 'c162', '45d7', 'bc73', '17a019c581b1'].join('-');
function trustedAllowlistRegexes(config) {
    const allowlist = /^\[allowlist\]\s*$([\s\S]*)/mu.exec(config)?.[1];
    const array = allowlist === undefined ? undefined : /^\s*regexes\s*=\s*\[([\s\S]*?)^\s*\]/mu.exec(allowlist)?.[1];
    if (array === undefined) {
        return undefined;
    }
    const entries = array
        .replace(/#.*$/gmu, '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    const values = entries.map((entry) => /^'''([^']*)'''$/u.exec(entry));
    return values.every((value) => value !== null) ? values.map((value) => value[1]) : undefined;
}

const configuredAllowlistRegexes = trustedAllowlistRegexes(gitleaksConfig);
const exactAllowlistRegexes = [
    '64c64660ceed813476b314f52136d9698e075622',
    '0354489231f6a874331aer4927569297c7fea4d5',
    'idempotency-1',
    '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    rfc4122ExampleUuid,
    rfc4122ExampleUuidSuccessor,
    reviewPublicationRecoveryUuid,
    deliveryLockRecoveryUuid,
    deliveryLockSecondRecoveryUuid,
];
expect(
    gitleaksConfig.includes(`'''${rfc4122ExampleUuid}'''`) &&
        gitleaksConfig.includes(`'''${rfc4122ExampleUuidSuccessor}'''`),
    'trusted Gitleaks config must allowlist RFC 4122 example UUID token fixtures'
);
expect(
    configuredAllowlistRegexes?.includes(reviewPublicationRecoveryUuid) === true,
    'trusted Gitleaks config must allowlist the exact PR #3342 review-publication recovery UUID'
);
expect(
    JSON.stringify(configuredAllowlistRegexes) === JSON.stringify(exactAllowlistRegexes),
    'trusted Gitleaks config must preserve the exact audited literal allowlist without wildcard or alternation broadening'
);
expect(
    JSON.stringify(trustedAllowlistRegexes(gitleaksConfig.replace(`'''${reviewPublicationRecoveryUuid}'''`, `'''${reviewPublicationRecoveryUuid}|.*'''`))) !==
        JSON.stringify(exactAllowlistRegexes),
    'trusted Gitleaks config must reject the triple-quoted review-publication UUID-or-dot-star mutation'
);
expect(
    trustedAllowlistRegexes(gitleaksConfig.replace(`'''${reviewPublicationRecoveryUuid}'''`, `"${reviewPublicationRecoveryUuid}|.*"`)) ===
        undefined,
    'trusted Gitleaks config must reject a basic-quoted review-publication UUID-or-dot-star mutation'
);
expect(gitleaksHelper.includes('--log-opts=--all'), 'secret scan must scan the full fetched git history, not only a PR diff');
expect(gitleaksHelper.includes('--redact=100'), 'secret scan must redact secrets from logs and stdout');
expect(
    secretScanRun ===
        'sh "$GITHUB_WORKSPACE/trusted-scanner/scripts/run-gitleaks-history-scan.sh" "$GITHUB_WORKSPACE/scan-target/.git"',
    'secret scan must execute only the trusted helper against the target Git database, outside target-controlled config files'
);
expect(secretScan?.['working-directory'] === '${{ github.workspace }}', 'secret scan must run outside the untrusted checkout');
expect(positiveControl?.env?.GITLEAKS_EXPECTED_LEAK_EXIT_CODE === 79, 'positive control must use a distinct expected leak exit code');
expect(
    positiveControlRun.includes('mktemp -d "$RUNNER_TEMP/gitleaks-positive-control.XXXXXX"'),
    'positive control must use a temporary runner path'
);
expect(
    positiveControlRun.includes("synthetic_access_key=$(printf '%s%s%s' 'AKIA' 'QAZ2WSX3' 'EDC4RFV5')"),
    'positive control secret must be assembled at runtime'
);
expect(
    positiveControlRun.includes('mkdir -p "$positive_control_repo/public/wasm"') &&
        positiveControlRun.includes('aws_access_key_id = "%s" // gitleaks:allow') &&
        positiveControlRun.includes('> "$positive_control_repo/public/wasm/fixture.js"'),
    'positive control must place an annotated secret under a formerly excluded path'
);
expect(
    positiveControlRun.includes('cat > "$positive_control_repo/.gitleaks.toml"') &&
        positiveControlRun.includes('regexes = [\'\'\'.*\'\'\']') &&
        positiveControlRun.includes('git -C "$positive_control_repo" add public/wasm/fixture.js .gitleaks.toml'),
    'positive control must commit a target-root config that would suppress the synthetic secret if loaded'
);
expect(
    positiveControlRun.includes('GITLEAKS_EXIT_CODE="$GITLEAKS_EXPECTED_LEAK_EXIT_CODE"'),
    'positive control must run the helper with the distinct leak exit code'
);
expect(
    positiveControlRun.includes(
        'sh "$GITHUB_WORKSPACE/trusted-scanner/scripts/run-gitleaks-history-scan.sh" "$positive_control_repo/.git"'
    ),
    'positive control must scan the temporary repository Git database with the trusted helper'
);
expect(positiveControl?.['working-directory'] === '${{ github.workspace }}', 'positive control must run outside the untrusted checkout');
expect(
    positiveControlRun.includes('positive_control_status') && positiveControlRun.includes('-ne "$GITLEAKS_EXPECTED_LEAK_EXIT_CODE"'),
    'positive control must require the exact leak exit code'
);
expect(
    !gitleaksHelper.includes('GITHUB_EVENT_NAME') &&
        !gitleaksHelper.includes('github.event') &&
        !secretScanRun.includes('GITHUB_EVENT_NAME') &&
        !secretScanRun.includes('github.event') &&
        !positiveControlRun.includes('GITHUB_EVENT_NAME') &&
        !positiveControlRun.includes('github.event'),
    'secret scan invocation must not branch on the triggering event'
);
expect(!secretScanEnvJson.includes('GITHUB_TOKEN') && !secretScanEnvJson.includes('GITLEAKS_LICENSE'), 'secret scan must not require token or license secrets');
expect(
    unitRun === 'pnpm run test:run --shard=${{ matrix.shard }}/4',
    'unit shard must use explicit pnpm run so the wrapper receives only the Vitest shard argument'
);
expect(
    e2eRunStep?.run === 'pnpm test:e2e --shard=${{ matrix.shard }}/12 --reporter=blob',
    'end-to-end shard must keep its twelve-way split and blob reporter so the merged report observes every shard'
);
expect(
    stepNamed(nightlyUnit, 'Run shard')?.run === 'pnpm run test:run --shard=${{ matrix.shard }}/4',
    'nightly unit shard must use explicit pnpm run so the wrapper receives only the Vitest shard argument'
);
expect(
    stepNamed(nightlyE2e, 'Run shard')?.run === 'pnpm test:e2e --shard=${{ matrix.shard }}/12 --reporter=blob',
    'nightly end-to-end shard must keep its twelve-way split and blob reporter so the merged report observes every shard'
);
const shardFailureCondition = "${{ !cancelled() && steps.run_shard.outcome == 'failure' }}";
expect(
    unit?.['continue-on-error'] === undefined,
    'unit suite must not use job-level continue-on-error'
);
expect(
    e2e?.['continue-on-error'] === undefined,
    'end-to-end suite must not use job-level continue-on-error'
);
expect(unitRunStep?.id === 'run_shard', 'unit Run shard step must keep its stable id');
expect(e2eRunStep?.id === 'run_shard', 'end-to-end Run shard step must keep its stable id');
// Both suites are Gate members now, so a softened shard step would report a
// failing suite as a passing required check — the exact hole this pin closes.
// `continue-on-error` on any event, not merely on the pull-request events it
// used to carry, is what must stay absent.
expect(
    unitRunStep?.['continue-on-error'] === undefined,
    'unit Run shard must fail its job on every event so a failing shard fails the required Gate'
);
expect(
    e2eRunStep?.['continue-on-error'] === undefined,
    'end-to-end Run shard must fail its job on every event so a failing shard fails the required Gate'
);
expect(
    stepNamed(nightlyUnit, 'Run shard')?.['continue-on-error'] === undefined,
    'nightly unit Run shard must stay blocking'
);
expect(
    stepNamed(nightlyE2e, 'Run shard')?.['continue-on-error'] === undefined,
    'nightly end-to-end Run shard must stay blocking'
);
// A `continue-on-error` on any job concludes it success whatever its steps
// proved, and one on any step reports that step green whatever it ran. The
// pins above each cover one named job or step; this sweep covers every job in
// every file, because a softened leg reports a failing proof as a passing
// summary wherever it lands.
for (const [file, parsed] of [
    ['health-gates.yml', workflow],
    ['validation.yml', validationWorkflow],
    ['heavy-gates.yml', heavyWorkflow],
    ['nightly.yml', nightly],
]) {
    for (const [id, job] of Object.entries(parsed.jobs ?? {})) {
        expect(
            job?.['continue-on-error'] === undefined,
            `${file} job ${id} must not continue on error, which would conclude the leg success whatever it proved`
        );
        for (const step of job?.steps ?? []) {
            expect(
                step?.['continue-on-error'] === undefined,
                `${file} job ${id} step ${step?.name ?? '<unnamed>'} must not continue on error, which would report the step green whatever it ran`
            );
        }
    }
}
// The whole-file snapshot closes the class the named pins kept missing one
// dimension of: any edit to any key — pinned or never yet named — fails here
// until the record is regenerated and the diff reviewed.
let snapshotError;
try {
    assertWorkflowSnapshotMatch(
        readRecordedWorkflowSnapshot(process.env.REPO_ROOT),
        parseHealthGateWorkflows(process.env.REPO_ROOT)
    );
} catch (error) {
    snapshotError = error;
}
expect(
    snapshotError === undefined,
    `the four gate workflows must match the recorded snapshot: ${snapshotError?.message ?? ''}`
);

// The snapshot pins the four files' contents; the directory SET is pinned
// beside them, because a fifth workflow the parse never reads can mint a
// passing Gate over a red head.
let inventoryError;
try {
    assertWorkflowFileInventory(readRecordedWorkflowSnapshot(process.env.REPO_ROOT), process.env.REPO_ROOT);
} catch (error) {
    inventoryError = error;
}
expect(
    inventoryError === undefined,
    `the workflows directory must match the recorded file inventory: ${inventoryError?.message ?? ''}`
);

const workflowsByFile = {
    'health-gates.yml': workflow,
    'validation.yml': validationWorkflow,
    'heavy-gates.yml': heavyWorkflow,
    'nightly.yml': nightly,
};
// A shrunk shard list still reports green: every shard that ran passed, and
// the dropped shards never ran at all.
for (const [file, jobId, shards] of SHARD_MATRIX_JOBS) {
    const actual = workflowsByFile[file]?.jobs?.[jobId]?.strategy?.matrix?.shard;
    expect(
        Array.isArray(actual) &&
            actual.length === shards.length &&
            actual.every((shard, index) => shard === shards[index]),
        `${file} job ${jobId} must shard across exactly ${shards.join(', ')}`
    );
}
// A job-level permissions block reshapes one leg's token away from the
// workflow-level pin; these two files must grant nothing at job level.
for (const file of JOB_LEVEL_PERMISSION_FREE_FILES) {
    for (const [jobId, job] of Object.entries(workflowsByFile[file]?.jobs ?? {})) {
        expect(job?.permissions === undefined, `${file} job ${jobId} must inherit the workflow-level permissions`);
    }
}
// A deleted proof step leaves its job green while the proof never runs, and
// an added one runs unpinned; the inventory refuses both directions.
for (const [file, parsed] of Object.entries(workflowsByFile)) {
    const inventory = STEP_INVENTORY[file];
    expect(inventory !== undefined, `${file} must have a pinned step inventory`);
    const jobs = parsed.jobs ?? {};
    for (const jobId of Object.keys(jobs)) {
        expect(jobId in (inventory ?? {}), `${file} job ${jobId} must be in the pinned step inventory`);
    }
    for (const [jobId, expectedSteps] of Object.entries(inventory ?? {})) {
        const job = jobs[jobId];
        expect(job !== undefined, `${file} job ${jobId} must exist`);
        if (expectedSteps === null) {
            expect(job?.steps === undefined, `${file} job ${jobId} must not declare steps`);
            continue;
        }
        const actualSteps = (job?.steps ?? []).map((step) => step?.name);
        expect(
            actualSteps.length === expectedSteps.length &&
                actualSteps.every((name, index) => name === expectedSteps[index]),
            `${file} job ${jobId} steps must match the pinned inventory in order`
        );
    }
}
expect(
    stepNamed(nightlyUnit, 'Run shard')?.run === 'pnpm run test:run --shard=${{ matrix.shard }}/4',
    'nightly unit Run shard must run through the test:run wrapper that applies the census exclusion'
);
expect(
    unitFailureWarning?.if === shardFailureCondition,
    'unit shard failure warning must observe the failed Run shard outcome'
);
expect(
    e2eFailureWarning?.if === shardFailureCondition,
    'end-to-end shard failure warning must observe the failed Run shard outcome'
);
expectShardFailureWarning(unitFailureWarning, 'unit', 'Unit suite', '2');
expectShardFailureWarning(e2eFailureWarning, 'e2e', 'End-to-end', '11');
expect(
    dependencyReview?.if === 'github.event.pull_request != null',
    'dependency review must gate on the pull request payload, not on the pull_request event, so an approval run can validate the head after any in-flight push run finishes'
);
expect(
    dependencyReviewWith['base-ref'] === '${{ github.event.pull_request.base.sha }}',
    'dependency review must pass the explicit pull request base SHA, which the action cannot infer on a pull_request_review run'
);
expect(
    dependencyReviewWith['head-ref'] === '${{ github.event.pull_request.head.sha }}',
    'dependency review must pass the explicit pull request head SHA, which the action cannot infer on a pull_request_review run'
);
expect(gate?.name === 'Gate', 'required Gate job name must stay exact');
expect(browserAiWebGpu !== undefined, 'browser-ai-webgpu job must remain connected to the heavy workflow');
expect(
    (heavyGate?.needs ?? []).includes('browser-ai-webgpu'),
    'HeavyGate must depend on browser-ai-webgpu, which is the only runner that reaches the admitted side of AI availability'
);
expect(
    heavyGate?.if ===
        "${{ !cancelled() && (github.event_name != 'pull_request_review' || github.event.review.state == 'approved') }}",
    'HeavyGate must not report success over an all-skipped comment-only review run'
);
expect(!gateNeeds.includes('browser-ai-webgpu'), 'Gate must not depend on browser-ai-webgpu');
expect(
    gate?.if === '${{ !cancelled() }}',
    'Gate must cancel with superseded runs and must report on every pull_request'
);
// Job-level continue-on-error concludes the required check success over red
// needs, and a conditional guard step can skip the only refusal the summary
// has — either softening still reports a green Gate.
expect(
    gate?.['continue-on-error'] === undefined,
    'the Gate job must not continue on error, which would conclude success over failed needs'
);
expect(
    stepNamed(gate, 'Require every job to have succeeded or been skipped')?.if === undefined,
    'the Gate guard step must stay unconditional, since a skipped guard lets the job succeed unconditionally'
);
expect(
    heavyGate?.['continue-on-error'] === undefined,
    'the HeavyGate job must not continue on error, which would conclude success over failed needs'
);
expect(
    stepNamed(heavyGate, 'Require every job to have succeeded or been skipped')?.if === undefined,
    'the HeavyGate guard step must stay unconditional, since a skipped guard lets the job succeed unconditionally'
);
expect(
    Array.isArray(gateNeeds) &&
        gateNeeds.length === expectedGateNeeds.length &&
        gateNeeds.every((need, index) => need === expectedGateNeeds[index]),
    `Gate needs must stay exactly: ${expectedGateNeeds.join(', ')}`
);
// `unit` reaches the required Gate through the validation lane it lives in, and
// its shards fail their job, so a failing unit suite fails `Gate`.
expect(expectedValidationJobs.includes('unit'), 'unit suite must stay inside the validation lane the required Gate depends on');
// `e2e` deliberately does not. It is a heavy-lane job that no pull-request run
// executes, so listing it in `Gate` would have meant listing a job that is
// always `skipped` — a claim of coverage the check never had. It decides
// `HeavyGate` on approving-review runs and gates hard on the nightly train,
// and its merge enforcement arrives when `deliver`'s required-CI admission is
// armed.
for (const heavyOnly of ['e2e', 'e2e-report', 'browser-ai-webgpu', 'codeql', 'secrets', 'deploy-web']) {
    expect(
        !gateNeeds.includes(heavyOnly),
        `${heavyOnly} never runs on a pull-request push, so naming it in Gate would claim coverage the check does not have`
    );
    expect(
        !expectedValidationJobs.includes(heavyOnly),
        `${heavyOnly} belongs to the heavy workflow, not to the validation lane`
    );
}
expect(
    gateRun.includes('select(.value.result != "success" and .value.result != "skipped")') &&
        gateRun.includes('if [ -n "$failed" ]; then') &&
        gateRun.includes('exit 1') &&
        gateRun.includes("printf 'every job succeeded or was skipped\\n'"),
    'Gate must keep rejecting failed dependencies while accepting successful or skipped dependencies'
);
expect(
    heavyGateRun.includes('select(.value.result != "success" and .value.result != "skipped")') &&
        heavyGateRun.includes('if [ -n "$failed" ]; then') &&
        heavyGateRun.includes('exit 1') &&
        heavyGateRun.includes("printf 'every job succeeded or was skipped\\n'"),
    'HeavyGate must keep rejecting failed dependencies while accepting successful or skipped dependencies'
);
// The daily web train. It is the only route to production now that the Vercel
// Git integration is off, so what it refuses to deploy from matters as much as
// what it deploys.
const deployWeb = nightly.jobs?.['deploy-web'];
const deployWebNeeds = deployWeb?.needs ?? [];
// Every leg that validates the web artifact. The Rust workspace leg is one
// of them: it is the only test of daw-dsp, daw-wasm-decoder, proof-chamber
// and scoring, which ship in the web bundle as the committed
// `public/wasm/*` packages. The desktop shell ships nothing this deployment
// carries, so its native legs (native-macos, native-windows) must not
// freeze it.
const expectedDeployWebNeeds = [
    'static',
    'lint',
    'boundaries',
    'unit',
    'build',
    'rust',
    'e2e',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
];
const deployWebGuardStep = stepNamed(deployWeb, 'Require a validated revision of main');
const deployWebGuardRun = deployWebGuardStep?.run ?? '';
const deployWebResolveStep = stepNamed(deployWeb, 'Resolve the current production revision');
const deployWebSkipReportStep = stepNamed(deployWeb, 'Report why nothing was deployed');
const deployWebDeployRun = stepNamed(deployWeb, 'Deploy the prebuilt revision')?.run ?? '';
const deployWebAliasStep = stepNamed(deployWeb, 'Resolve the aliases of the deployment');
const deployWebIsolationStep = stepNamed(deployWeb, 'Assert cross-origin isolation on the deployment');
const deployWebArmingReport = stepNamed(deployWeb, 'Report the missing deployment credential')?.run ?? '';
const vercelConfig = JSON.parse(readFileSync(`${process.env.REPO_ROOT}/vercel.json`, 'utf8'));

expect(
    vercelConfig?.git?.deploymentEnabled?.main === false,
    'the Vercel Git integration must not deploy main, which is what leaves the schedule as the only route to production'
);
expect(
    vercelConfig?.git?.deploymentEnabled?.['**'] === false,
    'the Vercel Git integration must not deploy any other branch'
);
expect(
    deployWeb?.if ===
        "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')",
    'the daily web deploy must run only on the version-controlled schedule and a dispatch of main, since a dispatch otherwise carries whichever ref fired it; the Production environment branch policy is the environment-side half, pinned with the arming preconditions below'
);
expect(
    deployWebGuardStep?.env?.TRAIN_REF === '${{ github.ref }}',
    'the daily web deploy must read the ref it is about to deploy, so the branch constraint does not rest on the job condition alone'
);
expect(
    deployWeb?.concurrency?.group === 'deploy-web-production',
    'the daily web deploy must serialise itself: nothing else keeps two runs off the production alias at once'
);
expect(
    deployWeb?.concurrency?.['cancel-in-progress'] === false,
    'the daily web deploy must queue behind a running deploy rather than cancel one mid-alias'
);
expect(
    deployWebAliasStep?.id === 'aliases',
    'the daily web deploy must publish the aliases of the deployment under a stable step id'
);
expect(
    deployWebAliasStep?.env?.DEPLOYMENT_URL === '${{ steps.deployment.outputs.url }}',
    'the alias step must read the aliases off the deployment this run just created, which is what proves the deployment took the domains being graded so no domain it never reached is graded'
);
expect(
    deployWebAliasStep?.env?.VERCEL_TOKEN === '${{ secrets.VERCEL_TOKEN }}' &&
        deployWebAliasStep?.env?.VERCEL_ORG_ID === '${{ secrets.VERCEL_ORG_ID }}',
    'the alias step must authenticate its Vercel query from the environment'
);
expect(
    deployWebAliasStep?.run === 'node scripts/resolveVercelDeploymentAliases.ts',
    'the daily web deploy must resolve its aliases through scripts/resolveVercelDeploymentAliases.ts, which is what validates every hostname before it reaches GITHUB_OUTPUT'
);
expect(
    deployWebIsolationStep?.env?.ALIASES === '${{ steps.aliases.outputs.aliases }}',
    'the daily web deploy must assert isolation against the public aliases of the deployment it just created; Standard Protection restricts the generated deployment URL behind Vercel Authentication, so grading that URL grades the vercel.com login page'
);
expect(
    deployWebIsolationStep?.run === 'sh scripts/assert-deployment-isolation.sh',
    'the daily web deploy must grade isolation through scripts/assert-deployment-isolation.sh, which is the only form of that check anything executes'
);
const isolationScript = readFileSync(`${process.env.REPO_ROOT}/scripts/assert-deployment-isolation.sh`, 'utf8');
expect(
    isolationScript.includes('cross-origin-opener-policy') &&
        isolationScript.includes('same-origin') &&
        isolationScript.includes('cross-origin-embedder-policy') &&
        isolationScript.includes('require-corp'),
    'the isolation script must name both headers cross-origin isolation needs'
);
expect(
    !isolationScript.includes('--location'),
    'the isolation script must not follow a redirect off the domain it is grading, since a restricted deployment URL redirects to vercel.com and those headers are not this deployment headers'
);
for (const stepName of ['Deploy the prebuilt revision']) {
    expect(
        stepNamed(deployWeb, stepName)?.env?.VERCEL_TOKEN === '${{ secrets.VERCEL_TOKEN }}',
        `${stepName} must authenticate the Vercel CLI from the environment`
    );
}
// The link step is the one place the org and project ids belong: `vercel link`
// reads them from the environment, and a missing id links the deploy to
// whatever the token's default resolves to.
const deployWebLinkStep = stepNamed(deployWeb, 'Link the Vercel CLI to the production project');
for (const [key, reference] of [
    ['VERCEL_TOKEN', '${{ secrets.VERCEL_TOKEN }}'],
    ['VERCEL_ORG_ID', '${{ secrets.VERCEL_ORG_ID }}'],
    ['VERCEL_PROJECT_ID', '${{ secrets.VERCEL_PROJECT_ID }}'],
]) {
    expect(
        deployWebLinkStep?.env?.[key] === reference,
        `Link the Vercel CLI to the production project must read ${key} from the environment`
    );
}
const deployWebBuildRun = stepNamed(deployWeb, 'Build the validated revision')?.run ?? '';
try {
    assertDeployWebBuildRun(deployWebBuildRun);
} catch (error) {
    expect(false, error instanceof Error ? error.message : String(error));
}
try {
    assertDeployWebJobNoVercelPull(deployWeb?.steps ?? []);
} catch (error) {
    expect(false, error instanceof Error ? error.message : String(error));
}
expect(
    deployWeb?.environment?.name === 'Production' &&
        deployWeb?.environment?.url === '${{ steps.deployment.outputs.url }}',
    'the daily web deploy must draw its credential from the Production environment and publish its URL only from a real deployment'
);
expect(
    deployWeb?.env?.DEPLOY_CREDENTIAL_PRESENT === "${{ secrets.VERCEL_TOKEN != '' }}",
    'the daily web deploy must gate its deploying steps on credential presence rather than on the token value'
);
expect(
    /^vercel@\d+\.\d+\.\d+$/u.test(deployWeb?.env?.VERCEL_CLI ?? ''),
    'the daily web deploy must pin an exact Vercel CLI version'
);
expect(
    Array.isArray(deployWebNeeds) &&
        deployWebNeeds.length === expectedDeployWebNeeds.length &&
        deployWebNeeds.every((need, index) => need === expectedDeployWebNeeds[index]),
    `the daily web deploy must depend on exactly: ${expectedDeployWebNeeds.join(', ')}`
);
expectNightlyDoesNotMintGate(nightly.jobs);
expect(
    deployWebDeployRun.includes('deploy --prebuilt --prod') &&
        deployWebDeployRun.includes('--meta githubCommitSha="$GITHUB_SHA"'),
    'the daily web deploy must ship the prebuilt artifact and record the revision it was built from'
);
const deployWebResults = (result, overrides = {}) =>
    JSON.stringify(
        Object.fromEntries(deployWebNeeds.map((need) => [need, { result: overrides[need] ?? result }]))
    );
expect(
    workflowShellStatus(deployWebGuardRun, {
        RESULTS: deployWebResults('success'),
        TRAIN_REF: 'refs/heads/main',
    }) === 0,
    'the daily web deploy must proceed when every validation leg succeeded on main'
);
// `unit` is a fast leg and `e2e` the slow half of the nightly train. Probing
// one of each proves the guard reads its whole needs map rather than a
// favoured entry.
for (const result of ['failure', 'cancelled', 'skipped']) {
    expect(
        workflowShellStatus(deployWebGuardRun, {
            RESULTS: deployWebResults('success', { unit: result }),
            TRAIN_REF: 'refs/heads/main',
        }) !== 0,
        `the daily web deploy must refuse to promote a revision whose unit leg was ${result}`
    );
}
for (const result of ['failure', 'cancelled', 'skipped']) {
    expect(
        workflowShellStatus(deployWebGuardRun, {
            RESULTS: deployWebResults('success', { e2e: result }),
            TRAIN_REF: 'refs/heads/main',
        }) !== 0,
        `the daily web deploy must refuse to promote a revision whose e2e leg was ${result}`
    );
}
for (const ref of ['refs/heads/agent/2940/daily-train', 'refs/tags/v1.0.0', 'main']) {
    expect(
        workflowShellStatus(deployWebGuardRun, { RESULTS: deployWebResults('success'), TRAIN_REF: ref }) !== 0,
        `the daily web deploy must refuse to promote ${ref}, which is not main`
    );
}

// Entry to the deploy queue is ordered by when each run's validation legs
// finished, and a re-run replays its original run's SHA, so the candidate can
// be a revision main has already moved past in the queue while still
// descending from what production serves. The production-revision step below
// decides on ancestry, not tip equality, and runs inside the same queue.
expect(
    deployWebResolveStep?.id === 'production',
    'the daily web deploy must publish its production-revision decision under a stable step id'
);
expect(
    deployWebResolveStep?.env?.CANDIDATE_REVISION === '${{ github.sha }}',
    'the production-revision step must read the revision this run is about to deploy'
);
expect(
    deployWebResolveStep?.env?.GITHUB_TOKEN === '${{ github.token }}',
    'the production-revision step must authenticate its ancestry comparison with a GitHub token'
);
expect(
    deployWebResolveStep?.env?.VERCEL_TOKEN === '${{ secrets.VERCEL_TOKEN }}' &&
        deployWebResolveStep?.env?.VERCEL_ORG_ID === '${{ secrets.VERCEL_ORG_ID }}' &&
        deployWebResolveStep?.env?.VERCEL_PROJECT_ID === '${{ secrets.VERCEL_PROJECT_ID }}',
    'the production-revision step must authenticate its Vercel query from the environment'
);
expect(
    deployWebResolveStep?.run === 'node scripts/resolveVercelProductionDeployment.ts',
    'the daily deploy train must decide through scripts/resolveVercelProductionDeployment.ts'
);
const credentialCondition = "env.DEPLOY_CREDENTIAL_PRESENT == 'true'";
for (const stepName of [
    'Checkout the validated revision',
    'Enable Corepack',
    'Set up pnpm',
    'Set up Node',
    'Resolve the current production revision',
]) {
    expect(
        stepNamed(deployWeb, stepName)?.if === credentialCondition,
        `${stepName} must not run without the deployment credential`
    );
}
for (const stepName of [
    'Install dependencies',
    'Link the Vercel CLI to the production project',
    'Build the validated revision',
    'Deploy the prebuilt revision',
    'Resolve the aliases of the deployment',
    'Assert cross-origin isolation on the deployment',
]) {
    expect(
        stepNamed(deployWeb, stepName)?.if === `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
        `${stepName} must run only for a candidate production does not already serve`
    );
}
expect(
    deployWebSkipReportStep?.if === `${credentialCondition} && steps.production.outputs.deploy != 'true'`,
    'the daily web deploy must report why nothing was deployed only when credentialed but not deploying'
);
expect(
    deployWebSkipReportStep?.env?.REASON === "${{ steps.production.outputs.reason }}",
    'the skip report must read the decision reason the production-revision step published'
);
// A step-level `if` can skip, and a skipped step fails nothing: the job then
// succeeds having never run the proof. Every step condition in the four
// workflows must be one of these exact, individually pinned exceptions — the
// shard-failure reporters and blob uploads above, and the deploy legs pinned
// beside their job. An `if` anywhere else retires a proof by flipping the
// condition while every other pin stays green.
const allowedStepConditions = [
    ['validation.yml', 'unit', 'Report shard failure', shardFailureCondition],
    ['heavy-gates.yml', 'e2e', 'Report shard failure', shardFailureCondition],
    ['heavy-gates.yml', 'e2e', 'Upload blob report', '${{ !cancelled() }}'],
    ['nightly.yml', 'unit', 'Report shard failure', shardFailureCondition],
    ['nightly.yml', 'e2e', 'Report shard failure', shardFailureCondition],
    ['nightly.yml', 'e2e', 'Upload blob report', '${{ !cancelled() }}'],
    ['nightly.yml', 'deploy-web', 'Report the missing deployment credential', "env.DEPLOY_CREDENTIAL_PRESENT != 'true'"],
    ['nightly.yml', 'deploy-web', 'Checkout the validated revision', credentialCondition],
    ['nightly.yml', 'deploy-web', 'Enable Corepack', credentialCondition],
    ['nightly.yml', 'deploy-web', 'Set up pnpm', credentialCondition],
    ['nightly.yml', 'deploy-web', 'Set up Node', credentialCondition],
    ['nightly.yml', 'deploy-web', 'Resolve the current production revision', credentialCondition],
    [
        'nightly.yml',
        'deploy-web',
        'Report why nothing was deployed',
        `${credentialCondition} && steps.production.outputs.deploy != 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Install dependencies',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Link the Vercel CLI to the production project',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Build the validated revision',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Deploy the prebuilt revision',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Assert cross-origin isolation on the deployment',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    [
        'nightly.yml',
        'deploy-web',
        'Resolve the aliases of the deployment',
        `${credentialCondition} && steps.production.outputs.deploy == 'true'`,
    ],
    // The measurement record is the diagnostic for a failed latency run, so it
    // uploads even when the measurement itself failed.
    ['nightly.yml', 'desktop-measure', 'Upload the measurement record', 'always()'],
];
const seenAllowedSteps = new Set();
for (const [file, parsed] of [
    ['health-gates.yml', workflow],
    ['validation.yml', validationWorkflow],
    ['heavy-gates.yml', heavyWorkflow],
    ['nightly.yml', nightly],
]) {
    for (const [id, job] of Object.entries(parsed.jobs ?? {})) {
        for (const step of job?.steps ?? []) {
            if (step?.if === undefined) {
                continue;
            }
            const label = `${file} job ${id} step ${step?.name ?? '<unnamed>'}`;
            const pin = allowedStepConditions.find(
                ([pinFile, pinJob, pinStep]) => pinFile === file && pinJob === id && pinStep === step?.name
            );
            expect(pin !== undefined, `${label} must stay unconditional`);
            if (pin !== undefined) {
                expect(step?.if === pin[3], `${label} must retain its pinned condition`);
                seenAllowedSteps.add(`${file}${id}${step?.name}`);
            }
        }
    }
}
// An allowlist entry that matches no live step is a condition nobody pins any
// more, so the sweep refuses the orphan rather than letting the list rot.
for (const [pinFile, pinJob, pinStep] of allowedStepConditions) {
    expect(
        seenAllowedSteps.has(`${pinFile}${pinJob}${pinStep}`),
        `${pinFile} job ${pinJob} step ${pinStep} must carry its pinned condition`
    );
}
for (const precondition of [
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    'deployment branch policy limited to `main`',
]) {
    expect(
        deployWebArmingReport.includes(precondition),
        `the gated-off report must name every arming precondition, including ${precondition}; the branch policy is what binds a dispatched copy of this workflow, which no in-file condition can`
    );
}

expect(nightlyReport?.name === 'Nightly failure report', 'nightly report job must remain present');
expect(
    nightlyReportCheckout !== undefined,
    'nightly reporter must run inside a real git repository, since a gh build can consult local git for repo resolution even when every invocation already passes --repo'
);
expect(
    nightlyReportCheckout?.uses === nightlyStaticCheckoutUses && nightlyStaticCheckoutUses !== '',
    'nightly reporter checkout must use the same pinned actions/checkout ref as the rest of the nightly workflow'
);
expect(
    nightlyReportCheckout?.with?.['persist-credentials'] === false,
    'nightly reporter checkout must not persist a credential this job never pushes with'
);
expect(
    nightlyReportCheckout?.with?.['sparse-checkout'] === '.github',
    'nightly reporter checkout must stay sparse so it does not pull the ~971 MiB public/samples payload for a job that only needs to file an issue'
);
expect(
    nightlyReportRun.includes('gh issue list --repo "$GITHUB_REPOSITORY"') &&
        nightlyReportRun.includes('gh issue comment "$existing" --repo "$GITHUB_REPOSITORY"') &&
        nightlyReportRun.includes('gh issue create --repo "$GITHUB_REPOSITORY"'),
    'every nightly reporter issue operation must target $GITHUB_REPOSITORY'
);

const maliciousHelperMarker = `${process.env.TEST_TEMP_ROOT}/pr-owned-helper-invoked.log`;
const workflowCommandLog = `${process.env.TEST_TEMP_ROOT}/workflow-secret-scan.log`;
writeFileSync(workflowCommandLog, '');
const nightlyIssueLog = `${process.env.TEST_TEMP_ROOT}/nightly-issue.log`;
const fixtureRepository = `fixture-owner-${process.pid}/fixture-repository`;
const nightlyReportEnv = {
    GITHUB_REPOSITORY: fixtureRepository,
    GH_ISSUE_LOG: nightlyIssueLog,
    PATH: `${process.env.FAKE_BIN}:${process.env.PATH}`,
    RESULTS: '{"static":{"result":"failure"},"lint":{"result":"success"}}',
    RUN_URL: 'nightly-run-123',
};
writeFileSync(nightlyIssueLog, '');
runWorkflowShell('nightly report existing issue', nightlyReportRun, { ...nightlyReportEnv, GH_ISSUE_MODE: 'existing' });
const existingIssueCommands = readFileSync(nightlyIssueLog, 'utf8').trim().split('\n');
expect(existingIssueCommands.some((command) => command.startsWith('issue list ') && command.includes(`--repo ${fixtureRepository}`)), 'existing path must list issues in the repository');
expect(existingIssueCommands.some((command) => command.startsWith('issue comment 42 ') && command.includes(`--repo ${fixtureRepository}`)), 'existing path must comment on the existing issue in the repository');
expect(!existingIssueCommands.some((command) => command.startsWith('issue create ')), 'existing path must not create an issue');
writeFileSync(nightlyIssueLog, '');
runWorkflowShell('nightly report missing issue', nightlyReportRun, { ...nightlyReportEnv, GH_ISSUE_MODE: 'none' });
const missingIssueCommands = readFileSync(nightlyIssueLog, 'utf8').trim().split('\n');
expect(missingIssueCommands.some((command) => command.startsWith('issue list ') && command.includes(`--repo ${fixtureRepository}`)), 'missing path must list issues in the repository');
expect(missingIssueCommands.some((command) => command.startsWith('issue create ') && command.includes(`--repo ${fixtureRepository}`)), 'missing path must create an issue in the repository');
expect(!missingIssueCommands.some((command) => command.startsWith('issue comment ')), 'missing path must not comment on an issue');
const workflowShellEnv = {
    GITHUB_WORKSPACE: process.env.TEST_TEMP_ROOT,
    RUNNER_TEMP: `${process.env.TEST_TEMP_ROOT}/workflow-runner`,
    PATH: `${process.env.FAKE_BIN}:${process.env.PATH}`,
    COMMAND_LOG: workflowCommandLog,
    GITLEAKS_VERSION: '8.30.1',
    GITLEAKS_SHA256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    MALICIOUS_HELPER_MARKER: maliciousHelperMarker,
};
runWorkflowShell('positive control', positiveControlRun, {
    ...workflowShellEnv,
    GITLEAKS_EXPECTED_LEAK_EXIT_CODE: '79',
    FAKE_GITLEAKS_STATUS: '79',
});
runWorkflowShell('secret scan', secretScanRun, { ...workflowShellEnv, FAKE_GITLEAKS_STATUS: '0' });
expect(!existsSync(maliciousHelperMarker), 'PR-owned target helper must not influence either scanner invocation');
const workflowGitleaksCommands = readFileSync(workflowCommandLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('gitleaks git '));
const trustedGitleaksPrefix = `gitleaks git --config ${process.env.TEST_TEMP_ROOT}/trusted-scanner/.gitleaks.toml --gitleaks-ignore-path ${process.env.TEST_TEMP_ROOT}/trusted-scanner/.gitleaksignore --ignore-gitleaks-allow --no-banner --no-color --redact=100 --verbose`;
expect(
    workflowGitleaksCommands.some(
        (command) =>
            command.startsWith(`${trustedGitleaksPrefix} --exit-code=79 --log-opts=--all `) &&
            command.includes('/gitleaks-positive-control.') &&
            command.endsWith('/.git')
    ),
    'positive control must use trusted config and ignore inputs while scanning the fixture Git database'
);
expect(
    workflowGitleaksCommands.includes(
        `${trustedGitleaksPrefix} --exit-code=1 --log-opts=--all ${process.env.TEST_TEMP_ROOT}/scan-target/.git`
    ),
    'actual scan must use trusted config and exclude target-controlled config files from the scanner source path'
);

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`workflow secret scan contract failed: ${failure}`);
    }
    process.exit(1);
}

console.log('workflow secret scan contract: PASS');
NODE

gitleaks_version=8.30.1
gitleaks_sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
gitleaks_url="https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/gitleaks_${gitleaks_version}_linux_x64.tar.gz"
gitleaks_target="$temp_root/gitleaks-target"
mkdir -p "$gitleaks_target"

gitleaks_runner_temp="$temp_root/gitleaks-runner"
mkdir -p "$gitleaks_runner_temp"
gitleaks_archive="$gitleaks_runner_temp/gitleaks_${gitleaks_version}_linux_x64.tar.gz"
gitleaks_dir="$gitleaks_runner_temp/gitleaks-${gitleaks_version}"
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/gitleaks-success.log" \
    RUNNER_TEMP="$gitleaks_runner_temp" \
    GITLEAKS_VERSION="$gitleaks_version" \
    GITLEAKS_SHA256="$gitleaks_sha256" \
    sh "$temp_root/scripts/run-gitleaks-history-scan.sh" "$gitleaks_target" >/dev/null
printf '%s\n' \
    "curl --fail --location --proto =https --tlsv1.2 --silent --show-error --output $gitleaks_archive $gitleaks_url" \
    'sha256sum --check --status' \
    "sha256sum stdin: $gitleaks_sha256  $gitleaks_archive" \
    "tar -xzf $gitleaks_archive -C $gitleaks_dir gitleaks" \
    "gitleaks git --config $temp_root/.gitleaks.toml --gitleaks-ignore-path $temp_root/.gitleaksignore --ignore-gitleaks-allow --no-banner --no-color --redact=100 --verbose --exit-code=1 --log-opts=--all $gitleaks_target" \
    > "$temp_root/expected-gitleaks-success.log"
diff -u "$temp_root/expected-gitleaks-success.log" "$temp_root/gitleaks-success.log"

gitleaks_override_runner_temp="$temp_root/gitleaks-override-runner"
mkdir -p "$gitleaks_override_runner_temp"
gitleaks_override_archive="$gitleaks_override_runner_temp/gitleaks_${gitleaks_version}_linux_x64.tar.gz"
gitleaks_override_dir="$gitleaks_override_runner_temp/gitleaks-${gitleaks_version}"
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/gitleaks-override.log" \
    RUNNER_TEMP="$gitleaks_override_runner_temp" \
    GITLEAKS_VERSION="$gitleaks_version" \
    GITLEAKS_SHA256="$gitleaks_sha256" \
    GITLEAKS_EXIT_CODE=79 \
    sh "$temp_root/scripts/run-gitleaks-history-scan.sh" "$gitleaks_target" >/dev/null
printf '%s\n' \
    "curl --fail --location --proto =https --tlsv1.2 --silent --show-error --output $gitleaks_override_archive $gitleaks_url" \
    'sha256sum --check --status' \
    "sha256sum stdin: $gitleaks_sha256  $gitleaks_override_archive" \
    "tar -xzf $gitleaks_override_archive -C $gitleaks_override_dir gitleaks" \
    "gitleaks git --config $temp_root/.gitleaks.toml --gitleaks-ignore-path $temp_root/.gitleaksignore --ignore-gitleaks-allow --no-banner --no-color --redact=100 --verbose --exit-code=79 --log-opts=--all $gitleaks_target" \
    > "$temp_root/expected-gitleaks-override.log"
diff -u "$temp_root/expected-gitleaks-override.log" "$temp_root/gitleaks-override.log"

bad_checksum_runner_temp="$temp_root/gitleaks-bad-checksum-runner"
mkdir -p "$bad_checksum_runner_temp"
bad_checksum_archive="$bad_checksum_runner_temp/gitleaks_${gitleaks_version}_linux_x64.tar.gz"
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/gitleaks-bad-checksum.log" \
    RUNNER_TEMP="$bad_checksum_runner_temp" \
    GITLEAKS_VERSION="$gitleaks_version" \
    GITLEAKS_SHA256="$gitleaks_sha256" \
    FAKE_SHA256SUM_STATUS=44 \
    sh "$temp_root/scripts/run-gitleaks-history-scan.sh" "$gitleaks_target" >/dev/null 2>&1
bad_checksum_status=$?
set -e
test "$bad_checksum_status" -eq 44
printf '%s\n' \
    "curl --fail --location --proto =https --tlsv1.2 --silent --show-error --output $bad_checksum_archive $gitleaks_url" \
    'sha256sum --check --status' \
    "sha256sum stdin: $gitleaks_sha256  $bad_checksum_archive" \
    > "$temp_root/expected-gitleaks-bad-checksum.log"
diff -u "$temp_root/expected-gitleaks-bad-checksum.log" "$temp_root/gitleaks-bad-checksum.log"

# The isolation grader the daily web train runs after it deploys. The whole
# point of the check is which response it grades and which it refuses, so it is
# executed here against a fake curl answering fixture responses per hostname —
# real `curl --head` framing, CRLF line endings and all — rather than read for
# substrings.
isolation_bin="$temp_root/bin-isolation"
isolation_responses="$temp_root/isolation-responses"
mkdir -p "$isolation_bin" "$isolation_responses"
cat > "$isolation_bin/curl" <<'SH'
#!/bin/sh
set -eu
url=
for argument in "$@"; do
    case "$argument" in
        https://*)
            url=$argument
            ;;
    esac
done
host=${url#https://}
host=${host%/}
if [ ! -f "$ISOLATION_RESPONSES/$host" ]; then
    printf 'no fixture response for %s\n' "$host" >&2
    exit 6
fi
cat "$ISOLATION_RESPONSES/$host"
SH
chmod +x "$isolation_bin/curl"

write_isolation_response() {
    response_host=$1
    shift
    : > "$isolation_responses/$response_host"
    for response_line in "$@"; do
        printf '%s\r\n' "$response_line" >> "$isolation_responses/$response_host"
    done
    printf '\r\n' >> "$isolation_responses/$response_host"
}

write_isolation_response 'restricted.vercel.app' \
    'HTTP/2 302 ' \
    'location: https://vercel.com/sso-api?url=https%3A%2F%2Frestricted.vercel.app%2F' \
    'content-length: 0'
write_isolation_response 'also-restricted.vercel.app' \
    'HTTP/2 302 ' \
    'location: https://vercel.com/sso-api?url=https%3A%2F%2Falso-restricted.vercel.app%2F' \
    'content-length: 0'
write_isolation_response 'app.sourdaw.studio' \
    'HTTP/2 200 ' \
    'content-type: text/html; charset=utf-8' \
    'cross-origin-opener-policy: same-origin' \
    'cross-origin-embedder-policy: require-corp'
write_isolation_response 'no-coep.sourdaw.studio' \
    'HTTP/2 200 ' \
    'content-type: text/html; charset=utf-8' \
    'cross-origin-opener-policy: same-origin'
# `same-origin-allow-popups` contains `same-origin` and is not cross-origin
# isolated: the whole reason both header matches are anchored to the line.
write_isolation_response 'popups.sourdaw.studio' \
    'HTTP/2 200 ' \
    'content-type: text/html; charset=utf-8' \
    'cross-origin-opener-policy: same-origin-allow-popups' \
    'cross-origin-embedder-policy: require-corp'
# A redirect that is not the Vercel Authentication one is not a reason to skip
# a domain: it is a domain that did not answer, and the run fails on it. The
# location is on vercel.com but is not `/sso-api`, so a skip condition widened
# to the host alone would wrongly pass this domain over.
write_isolation_response 'moved.sourdaw.studio' \
    'HTTP/2 301 ' \
    'location: https://vercel.com/login' \
    'content-length: 0'

run_isolation_case() {
    isolation_case=$1
    isolation_aliases=$2
    set +e
    PATH="$isolation_bin:$PATH" \
        ISOLATION_RESPONSES="$isolation_responses" \
        RUNNER_TEMP="$temp_root/isolation-runner-$isolation_case" \
        ALIASES="$isolation_aliases" \
        sh "$temp_root/scripts/assert-deployment-isolation.sh" \
        > "$temp_root/isolation-$isolation_case.out" 2>&1
    isolation_status=$?
    set -e
}

run_isolation_case skipped-then-graded 'restricted.vercel.app app.sourdaw.studio'
isolation_skipped_then_graded_status=$isolation_status
test "$isolation_skipped_then_graded_status" -eq 0
grep -qF 'https://restricted.vercel.app/ is behind Vercel Authentication; not a public production domain' \
    "$temp_root/isolation-skipped-then-graded.out"
grep -qF 'https://app.sourdaw.studio/ is cross-origin isolated' "$temp_root/isolation-skipped-then-graded.out"

run_isolation_case all-restricted 'restricted.vercel.app also-restricted.vercel.app'
isolation_all_restricted_status=$isolation_status
test "$isolation_all_restricted_status" -eq 1
grep -qF 'no public production domain answered for this deployment' "$temp_root/isolation-all-restricted.out"
if grep -qF 'is cross-origin isolated' "$temp_root/isolation-all-restricted.out"; then
    printf 'a run in which every alias was restricted must grade no domain\n' >&2
    exit 1
fi

run_isolation_case missing-coep 'no-coep.sourdaw.studio'
isolation_missing_coep_status=$isolation_status
test "$isolation_missing_coep_status" -eq 1
grep -qF 'https://no-coep.sourdaw.studio/ is missing cross-origin-embedder-policy: require-corp' \
    "$temp_root/isolation-missing-coep.out"

run_isolation_case allow-popups 'popups.sourdaw.studio'
isolation_allow_popups_status=$isolation_status
test "$isolation_allow_popups_status" -eq 1
grep -qF 'https://popups.sourdaw.studio/ is missing cross-origin-opener-policy: same-origin' \
    "$temp_root/isolation-allow-popups.out"

run_isolation_case foreign-redirect 'moved.sourdaw.studio'
isolation_foreign_redirect_status=$isolation_status
test "$isolation_foreign_redirect_status" -eq 1
grep -qF 'https://moved.sourdaw.studio/ answered 301' "$temp_root/isolation-foreign-redirect.out"

set +e
PATH="$isolation_bin:$PATH" \
    ISOLATION_RESPONSES="$isolation_responses" \
    RUNNER_TEMP="$temp_root/isolation-runner-unset" \
    sh "$temp_root/scripts/assert-deployment-isolation.sh" > "$temp_root/isolation-unset.out" 2>&1
isolation_unset_status=$?
set -e
test "$isolation_unset_status" -ne 0
grep -qF 'ALIASES must be set to the public production aliases to grade' "$temp_root/isolation-unset.out"

# A PATH that has the fake npm but no cargo at all, used to prove the missing
# toolchain precondition. `sh` and `dirname` are the only external commands
# needed to reach the precondition, so they are the only ones linked in.
no_cargo_bin="$temp_root/bin-no-cargo"
mkdir -p "$no_cargo_bin"
cp "$fake_bin/npm" "$no_cargo_bin/npm"
ln -s "$(command -v sh)" "$no_cargo_bin/sh"
ln -s "$(command -v dirname)" "$no_cargo_bin/dirname"

set +e
server_output=$(PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-missing.log" \
    FAKE_SERVER_DEPS=missing \
    sh "$temp_root/scripts/health-gates-server.sh" 2>&1)
server_status=$?
set -e
test "$server_status" -eq 1
case "$server_output" in
    *'run: npm --prefix server ci'*) ;;
    *) exit 1 ;;
esac
printf '%s\n' 'npm --prefix server ls --depth=0 --silent --include=dev' > "$temp_root/expected-server-missing.log"
diff -u "$temp_root/expected-server-missing.log" "$temp_root/server-missing.log"

PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-success.log" \
    NODE_ENV=production \
    npm_config_omit=dev \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    'npm run build' \
    'cargo fmt --all --check' \
    'cargo clippy --workspace --exclude sourdaw-native --all-targets --all-features' \
    'cargo test --workspace --exclude sourdaw-native --all-features' \
    > "$temp_root/expected-server-success.log"
diff -u "$temp_root/expected-server-success.log" "$temp_root/server-success.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-test-failure.log" \
    FAKE_SERVER_TEST_STATUS=23 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
server_test_status=$?
set -e
test "$server_test_status" -eq 23
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    > "$temp_root/expected-server-test-failure.log"
diff -u "$temp_root/expected-server-test-failure.log" "$temp_root/server-test-failure.log"

# A missing Rust toolchain must be reported before any build runs, not
# discovered after the collaboration server has already been built.
set +e
no_cargo_output=$(PATH="$no_cargo_bin" \
    COMMAND_LOG="$temp_root/no-cargo.log" \
    sh "$temp_root/scripts/health-gates-server.sh" 2>&1)
no_cargo_status=$?
set -e
test "$no_cargo_status" -eq 1
case "$no_cargo_output" in
    *'error: cargo is not on PATH'*) ;;
    *) exit 1 ;;
esac
printf '%s\n' 'npm --prefix server ls --depth=0 --silent --include=dev' > "$temp_root/expected-no-cargo.log"
diff -u "$temp_root/expected-no-cargo.log" "$temp_root/no-cargo.log"

# A failing Rust workspace must fail the gate with cargo's own exit code, and
# must stop before the remaining legs run.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/cargo-clippy-failure.log" \
    FAKE_CARGO_CLIPPY_STATUS=101 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
cargo_clippy_status=$?
set -e
test "$cargo_clippy_status" -eq 101
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    'npm run build' \
    'cargo fmt --all --check' \
    'cargo clippy --workspace --exclude sourdaw-native --all-targets --all-features' \
    > "$temp_root/expected-cargo-clippy-failure.log"
diff -u "$temp_root/expected-cargo-clippy-failure.log" "$temp_root/cargo-clippy-failure.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/cargo-test-failure.log" \
    FAKE_CARGO_TEST_STATUS=134 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
cargo_test_status=$?
set -e
test "$cargo_test_status" -eq 134

printf '%s\n' \
    "missing server dependencies exit: $server_status" \
    'server remediation and production build dependency sequence: PASS' \
    "server test failure exit: $server_test_status" \
    "missing cargo exit: $no_cargo_status" \
    "cargo clippy failure exit: $cargo_clippy_status" \
    "cargo test failure exit (SIGABRT): $cargo_test_status" \
    'gitleaks helper scan argv: PASS' \
    "gitleaks helper bad checksum exit: $bad_checksum_status" \
    'gitleaks helper bad checksum stops before extract/scan: PASS' \
    "isolation grader skipped-then-graded exit: $isolation_skipped_then_graded_status" \
    "isolation grader all-restricted exit: $isolation_all_restricted_status" \
    "isolation grader missing-COEP exit: $isolation_missing_coep_status" \
    "isolation grader same-origin-allow-popups exit: $isolation_allow_popups_status" \
    "isolation grader foreign-redirect exit: $isolation_foreign_redirect_status" \
    "isolation grader unset ALIASES exit: $isolation_unset_status" \
    'rust workspace gate failure propagation: PASS'
