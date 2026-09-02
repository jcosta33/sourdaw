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
cp "$repo_root/scripts/health-gates-web.sh" "$temp_root/scripts/health-gates-web.sh"
cp "$repo_root/scripts/health-gates-server.sh" "$temp_root/scripts/health-gates-server.sh"
cp "$repo_root/scripts/run-gitleaks-history-scan.sh" "$temp_root/scripts/run-gitleaks-history-scan.sh"
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

# The freshness step's only external command. It lives in its own bin directory
# because the Gitleaks controls above run real `git` through $fake_bin.
git_tip_bin="$temp_root/bin-git-tip"
mkdir -p "$git_tip_bin"
cat > "$git_tip_bin/git" <<'SH'
#!/bin/sh
set -eu
printf 'git %s\n' "$*" >> "${COMMAND_LOG:-/dev/null}"
if [ -n "${FAKE_MAIN_TIP:-}" ]; then
    printf '%s\trefs/heads/main\n' "$FAKE_MAIN_TIP"
fi
SH
chmod +x "$git_tip_bin/git"

WORKFLOW_PATH="$repo_root/.github/workflows/health-gates.yml" NIGHTLY_PATH="$repo_root/.github/workflows/nightly.yml" REPO_ROOT="$repo_root" TEST_TEMP_ROOT="$temp_root" FAKE_BIN="$fake_bin" GIT_TIP_BIN="$git_tip_bin" node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(process.env.WORKFLOW_PATH, 'utf8'));
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
const concurrency = workflow.concurrency;
const decide = workflow.jobs?.decide;
const staticJob = workflow.jobs?.static;
const lint = workflow.jobs?.lint;
const boundaries = workflow.jobs?.boundaries;
const smoke = workflow.jobs?.smoke;
const prSecrets = workflow.jobs?.['pr-secrets'];
const prSecretsTrustedCheckout = stepNamed(prSecrets, 'Checkout trusted scanner');
const prSecretsTargetCheckout = stepNamed(prSecrets, 'Checkout scan target');
const prSecretsScanRun = stepNamed(prSecrets, 'Scan pull request diff for secrets')?.run ?? '';
const prMergeControl = stepNamed(prSecrets, 'Validate PR merge diff secret scanner');
const prMergeControlRun = prMergeControl?.run ?? '';
const TOKEN_PATTERN = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./iu;
const secrets = nightly.jobs?.secrets;
const unit = workflow.jobs?.unit;
const nightlyUnit = nightly.jobs?.unit;
const e2e = nightly.jobs?.e2e;
const gate = workflow.jobs?.gate;
const dependencyReview = workflow.jobs?.['dependency-review'];
const dependencyReviewWith = stepNamed(dependencyReview, 'Review dependency changes')?.with ?? {};
const browserAiWebGpu = nightly.jobs?.['browser-ai-webgpu'];
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
const gateNeeds = gate?.needs ?? [];
const expectedGateNeeds = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'dependency-review',
    'pr-secrets',
    'smoke',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'native-parity',
];

expect(workflow.name === 'Health gates', 'workflow name must stay Health gates');
expect(
    Object.keys(events ?? {}).sort().join('\0') === 'pull_request',
    'Health gates on must be exactly pull_request'
);
expect(
    concurrency?.group === 'health-gates-${{ github.event.pull_request.number }}',
    'pull-request runs must share a PR-number concurrency group'
);
expect(
    concurrency?.['cancel-in-progress'] === true,
    'a newer pull_request run must cancel in-progress validation of the same PR'
);
expect(decide?.if === undefined, 'decide must run on every pull_request');
expect(nightly.name === 'Nightly', 'nightly workflow name must stay Nightly');
expect(
    Object.keys(nightly.on ?? {}).sort().join('\0') === 'schedule\0workflow_dispatch',
    'Nightly on must be exactly schedule and workflow_dispatch'
);
expectNightlyDoesNotMintGate(nightly.jobs);
expect(
    nightly.concurrency?.group === 'nightly-${{ github.run_id }}',
    'nightly must isolate each run on its own run id'
);
expect(nightly.concurrency?.['cancel-in-progress'] === false, 'nightly must not cancel an in-progress train');
expect(workflow.jobs?.['deploy-web'] === undefined, 'the pull-request workflow must not deploy');
expect(workflow.jobs?.e2e === undefined, 'the pull-request workflow must not run the end-to-end suite');
const allFalseScopes = { rust: 'false', server: 'false', e2e: 'false', web: 'false' };
const pullRequestScopes = { rust: 'true', server: 'false', e2e: 'true', web: 'false' };
const unclassifiedScopes = { ...allFalseScopes, unclassified: 'true' };
function runNightlyResolveScope() {
    const outputPath = `${process.env.TEST_TEMP_ROOT}/resolve-scope-nightly.output`;
    writeFileSync(outputPath, '');
    const result = spawnSync('bash', ['-c', nightlyResolveScopeRun], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });
    expect(result.status === 0, `Nightly resolve scope must execute: ${result.stderr.trim()}`);
    return readFileSync(outputPath, 'utf8');
}
expect(
    runNightlyResolveScope() === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\ncode=true\n',
    'nightly must enable the heavy path and every scope'
);
expect(
    runResolveScope('pull_request', pullRequestScopes) === 'rust=true\nserver=false\ne2e=true\nweb=false\ncode=true\n',
    'pull_request must preserve path-filter outputs without a heavy scope'
);
expect(
    runResolveScope('pull_request', allFalseScopes) === 'rust=false\nserver=false\ne2e=false\nweb=false\ncode=false\n',
    'a head that claims no scope must report no code-bearing change'
);
expect(
    runResolveScope('pull_request', unclassifiedScopes) === 'rust=true\nserver=true\ne2e=true\nweb=true\ncode=true\n',
    'an unclassified path must force every fast scope rather than skipping the checks that would observe it'
);
expect(
    lint?.if === "needs.decide.outputs.code == 'true'" && boundaries?.if === "needs.decide.outputs.code == 'true'",
    'lint and boundaries must skip a head that carries only prose'
);
expect(staticJob?.if === undefined, 'static must stay unconditional so release inventory observes prose changes too');
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
expect(secrets?.if === "needs.decide.outputs.heavy == 'true'", 'secrets job must remain on the heavy path');
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
const allowlistRegexes = /\[allowlist\][\s\S]*?regexes\s*=\s*\[([\s\S]*?)\]/u.exec(gitleaksConfig)?.[1];
const configuredAllowlistRegexes = [...(allowlistRegexes ?? '').matchAll(/'''([^']*)'''/gu)].map((match) => match[1]);
const exactAllowlistRegexes = [
    '64c64660ceed813476b314f52136d9698e075622',
    '0354489231f6a874331aer4927569297c7fea4d5',
    'idempotency-1',
    '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    rfc4122ExampleUuid,
    rfc4122ExampleUuidSuccessor,
    reviewPublicationRecoveryUuid,
];
expect(
    gitleaksConfig.includes(`'''${rfc4122ExampleUuid}'''`) &&
        gitleaksConfig.includes(`'''${rfc4122ExampleUuidSuccessor}'''`),
    'trusted Gitleaks config must allowlist RFC 4122 example UUID token fixtures'
);
expect(
    allowlistRegexes?.includes(`'''${reviewPublicationRecoveryUuid}'''`) === true,
    'trusted Gitleaks config must allowlist the exact PR #3342 review-publication recovery UUID'
);
expect(
    JSON.stringify(configuredAllowlistRegexes) === JSON.stringify(exactAllowlistRegexes),
    'trusted Gitleaks config must preserve the exact audited literal allowlist without wildcard or alternation broadening'
);
expect(
    !configuredAllowlistRegexes.includes(`${reviewPublicationRecoveryUuid}|.*`),
    'trusted Gitleaks config must reject the exact review-publication UUID-or-dot-star mutation'
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
expect(
    unitRunStep?.['continue-on-error'] === true,
    'pull-request unit Run shard must continue on error so Gate can still report'
);
expect(
    e2eRunStep?.['continue-on-error'] === undefined,
    'nightly end-to-end Run shard must stay blocking'
);
expect(
    stepNamed(nightlyUnit, 'Run shard')?.['continue-on-error'] === undefined,
    'nightly unit Run shard must stay blocking'
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
expect(browserAiWebGpu !== undefined, 'browser-ai-webgpu job must remain connected to the nightly workflow');
expect(!gateNeeds.includes('browser-ai-webgpu'), 'Gate must not depend on browser-ai-webgpu');
expect(
    gate?.if === '${{ !cancelled() }}',
    'Gate must cancel with superseded runs and must report on every pull_request'
);
expect(
    Array.isArray(gateNeeds) &&
        gateNeeds.length === expectedGateNeeds.length &&
        gateNeeds.every((need, index) => need === expectedGateNeeds[index]),
    `Gate needs must stay exactly: ${expectedGateNeeds.join(', ')}`
);
expect(!gateNeeds.includes('unit'), 'unit suite must remain outside required Gate needs');
expect(!gateNeeds.includes('e2e'), 'e2e suite must remain outside required Gate needs');
expect(!gateNeeds.includes('e2e-report'), 'e2e report must remain outside required Gate needs');
expect(
    gateRun.includes('select(.value.result != "success" and .value.result != "skipped")') &&
        gateRun.includes('if [ -n "$failed" ]; then') &&
        gateRun.includes('exit 1') &&
        gateRun.includes("printf 'every job succeeded or was skipped\\n'"),
    'Gate must keep rejecting failed dependencies while accepting successful or skipped dependencies'
);
// The daily web train. It is the only route to production now that the Vercel
// Git integration is off, so what it refuses to deploy from matters as much as
// what it deploys.
const deployWeb = nightly.jobs?.['deploy-web'];
const deployWebNeeds = deployWeb?.needs ?? [];
const expectedDeployWebNeeds = [
    'static',
    'lint',
    'boundaries',
    'unit',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'e2e',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
];
const deployWebGuardStep = stepNamed(deployWeb, 'Require a validated revision of main');
const deployWebGuardRun = deployWebGuardStep?.run ?? '';
const deployWebFreshnessStep = stepNamed(deployWeb, 'Refuse a stale candidate revision');
const deployWebFreshnessRun = deployWebFreshnessStep?.run ?? '';
const deployWebDeployRun = stepNamed(deployWeb, 'Deploy the prebuilt revision')?.run ?? '';
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
    'the daily web deploy must run only on the version-controlled schedule and a dispatch of main, since a dispatch otherwise carries whichever ref fired it and the Production environment has no branch policy'
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
    deployWebIsolationStep?.env?.DEPLOYMENT_URL === '${{ steps.deployment.outputs.url }}',
    'the daily web deploy must assert isolation against the deployment it just created, not against a fixed alias'
);
for (const stepName of ['Pull the production environment', 'Build the validated revision', 'Deploy the prebuilt revision']) {
    expect(
        stepNamed(deployWeb, stepName)?.env?.VERCEL_TOKEN === '${{ secrets.VERCEL_TOKEN }}',
        `${stepName} must authenticate the Vercel CLI from the environment`
    );
}
expect(
    deployWeb?.environment === 'Production',
    'the daily web deploy must draw its credential from the Production environment'
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
for (const result of ['failure', 'cancelled', 'skipped']) {
    expect(
        workflowShellStatus(deployWebGuardRun, {
            RESULTS: deployWebResults('success', { unit: result }),
            TRAIN_REF: 'refs/heads/main',
        }) !== 0,
        `the daily web deploy must refuse to promote a revision whose unit leg was ${result}`
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
// be a revision main has already moved past. The tip comparison is what makes
// the newest revision win.
expect(
    deployWebFreshnessStep?.id === 'freshness',
    'the daily web deploy must publish its freshness decision under a stable step id'
);
expect(
    deployWebFreshnessStep?.env?.CANDIDATE_REVISION === '${{ github.sha }}',
    'the freshness check must read the revision this run is about to deploy'
);
expect(
    deployWebFreshnessRun.includes('git ls-remote "https://github.com/$GITHUB_REPOSITORY.git" refs/heads/main') &&
        deployWebFreshnessRun.includes('"$tip" != "$CANDIDATE_REVISION"'),
    'the freshness check must compare the candidate against the current tip of main read from the remote'
);
const freshCondition = "env.DEPLOY_CREDENTIAL_PRESENT == 'true' && steps.freshness.outputs.fresh == 'true'";
for (const stepName of [
    'Checkout the validated revision',
    'Enable Corepack',
    'Set up Node',
    'Resolve the current production revision',
]) {
    expect(
        stepNamed(deployWeb, stepName)?.if === freshCondition,
        `${stepName} must not run for a revision that is no longer the tip of main`
    );
}
for (const stepName of [
    'Install dependencies',
    'Pull the production environment',
    'Build the validated revision',
    'Deploy the prebuilt revision',
    'Assert cross-origin isolation on the deployment',
]) {
    expect(
        stepNamed(deployWeb, stepName)?.if === `${freshCondition} && steps.production.outputs.deploy == 'true'`,
        `${stepName} must run only for a fresh candidate production does not already serve`
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

function runFreshness(candidateRevision, remoteTip) {
    const outputPath = `${process.env.TEST_TEMP_ROOT}/freshness-output`;
    const summaryPath = `${process.env.TEST_TEMP_ROOT}/freshness-summary`;
    writeFileSync(outputPath, '');
    writeFileSync(summaryPath, '');
    const result = spawnSync('bash', ['-c', deployWebFreshnessRun], {
        cwd: process.env.TEST_TEMP_ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${process.env.GIT_TIP_BIN}:${process.env.PATH}`,
            GITHUB_REPOSITORY: 'jcosta33/sourdaw',
            CANDIDATE_REVISION: candidateRevision,
            FAKE_MAIN_TIP: remoteTip,
            GITHUB_OUTPUT: outputPath,
            GITHUB_STEP_SUMMARY: summaryPath,
        },
    });
    return {
        status: result.status,
        stdout: result.stdout,
        outputs: readFileSync(outputPath, 'utf8'),
        summary: readFileSync(summaryPath, 'utf8'),
    };
}

const candidateRevision = '1'.repeat(40);
const newerTip = '2'.repeat(40);
const freshRun = runFreshness(candidateRevision, candidateRevision);
expect(
    freshRun.status === 0 && freshRun.outputs.includes('fresh=true'),
    'the daily web deploy must proceed when the candidate is the current tip of main'
);
const staleRun = runFreshness(candidateRevision, newerTip);
expect(
    staleRun.status === 0 && staleRun.outputs.includes('fresh=false') && !staleRun.outputs.includes('fresh=true'),
    'a candidate main has moved past must be a green refusal, not a deploy and not a failure'
);
expect(
    staleRun.stdout.includes(
        `stale candidate ${candidateRevision}, main is now ${newerTip}, deploying nothing`
    ) && staleRun.summary.includes(`stale candidate \`${candidateRevision}\``),
    'a stale refusal must say so loudly in the annotation and the step summary'
);
expect(
    runFreshness(candidateRevision, '').status !== 0,
    'an unreadable tip of main must fail the job rather than resolve to a deploy'
);

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

# A PATH that has the fake npm but no cargo at all, used to prove the missing
# toolchain precondition. `sh` and `dirname` are the only external commands
# needed to reach the precondition, so they are the only ones linked in.
no_cargo_bin="$temp_root/bin-no-cargo"
mkdir -p "$no_cargo_bin"
cp "$fake_bin/npm" "$no_cargo_bin/npm"
ln -s "$(command -v sh)" "$no_cargo_bin/sh"
ln -s "$(command -v dirname)" "$no_cargo_bin/dirname"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/lint-failure.log" \
    FAKE_LINT_STATUS=37 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
lint_status=$?
set -e
test "$lint_status" -eq 37
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    > "$temp_root/expected-lint-failure.log"
diff -u "$temp_root/expected-lint-failure.log" "$temp_root/lint-failure.log"

PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/web-success.log" \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:release-inventory' \
    'pnpm test:collection-scope' \
    'pnpm test:barrel-mocks' \
    'pnpm test:run' \
    'pnpm build' \
    > "$temp_root/expected-web-success.log"
diff -u "$temp_root/expected-web-success.log" "$temp_root/web-success.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/command-schema-failure.log" \
    FAKE_COMMAND_SCHEMA_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
command_schema_status=$?
set -e
test "$command_schema_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    > "$temp_root/expected-command-schema-failure.log"
diff -u "$temp_root/expected-command-schema-failure.log" "$temp_root/command-schema-failure.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/release-inventory-failure.log" \
    FAKE_RELEASE_INVENTORY_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
release_inventory_status=$?
set -e
test "$release_inventory_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:release-inventory' \
    > "$temp_root/expected-release-inventory-failure.log"
diff -u "$temp_root/expected-release-inventory-failure.log" "$temp_root/release-inventory-failure.log"

# A drifting vitest collection scope must fail the gate with the check's own exit
# code, and must stop before the suite runs — running the suite over an unknown
# file set is the outcome the check exists to prevent.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/collection-scope-failure.log" \
    FAKE_COLLECTION_SCOPE_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
collection_scope_status=$?
set -e
test "$collection_scope_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:release-inventory' \
    'pnpm test:collection-scope' \
    > "$temp_root/expected-collection-scope-failure.log"
diff -u "$temp_root/expected-collection-scope-failure.log" "$temp_root/collection-scope-failure.log"

# A barrel-mock coverage failure must abort the same way. True today only because
# health-gates-web.sh runs under `set -eu`; asserted here so a later refactor that
# swallows a non-zero status cannot pass this file. Same shape as the check above.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/barrel-mocks-failure.log" \
    FAKE_BARREL_MOCKS_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
barrel_mocks_status=$?
set -e
test "$barrel_mocks_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm census:ui -- --check' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:release-inventory' \
    'pnpm test:collection-scope' \
    'pnpm test:barrel-mocks' \
    > "$temp_root/expected-barrel-mocks-failure.log"
diff -u "$temp_root/expected-barrel-mocks-failure.log" "$temp_root/barrel-mocks-failure.log"
echo "barrel mock coverage failure stops before the suite: PASS"

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
    "lint failure exit: $lint_status" \
    'lint failure stops the web gate: PASS' \
    "release inventory failure exit: $release_inventory_status" \
    "collection scope failure exit: $collection_scope_status" \
    'collection scope failure stops before the suite: PASS' \
    "missing server dependencies exit: $server_status" \
    'server remediation and production build dependency sequence: PASS' \
    "server test failure exit: $server_test_status" \
    "missing cargo exit: $no_cargo_status" \
    "cargo clippy failure exit: $cargo_clippy_status" \
    "cargo test failure exit (SIGABRT): $cargo_test_status" \
    'gitleaks helper scan argv: PASS' \
    "gitleaks helper bad checksum exit: $bad_checksum_status" \
    'gitleaks helper bad checksum stops before extract/scan: PASS' \
    'rust workspace gate failure propagation: PASS'
