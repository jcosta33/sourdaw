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

WORKFLOW_PATH="$repo_root/.github/workflows/health-gates.yml" REPO_ROOT="$repo_root" TEST_TEMP_ROOT="$temp_root" FAKE_BIN="$fake_bin" node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(process.env.WORKFLOW_PATH, 'utf8'));
const gitleaksHelper = readFileSync(`${process.env.REPO_ROOT}/scripts/run-gitleaks-history-scan.sh`, 'utf8');
const failures = [];

function expect(condition, message) {
    if (!condition) {
        failures.push(message);
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
}

const events = workflow.on;
const decide = workflow.jobs?.decide;
const secrets = workflow.jobs?.secrets;
const gate = workflow.jobs?.gate;
const resolveScopeRun = stepNamed(decide, 'Resolve scope')?.run ?? '';
const trustedCheckout = stepNamed(secrets, 'Checkout trusted scanner');
const targetCheckout = stepNamed(secrets, 'Checkout scan target');
const positiveControl = stepNamed(secrets, 'Validate secret scanner positive control');
const positiveControlRun = positiveControl?.run ?? '';
const secretScan = stepNamed(secrets, 'Scan history for secrets');
const secretScanRun = secretScan?.run ?? '';
const secretScanUses = secretScan?.uses ?? '';
const secretsEnv = secrets?.env ?? {};
const secretScanEnvJson = JSON.stringify([secretsEnv, positiveControl?.env ?? {}, secretScan?.env ?? {}]);
const gateNeeds = gate?.needs ?? [];
const expectedGateNeeds = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'dependency-review',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'codeql',
    'secrets',
];

expect(workflow.name === 'Health gates', 'workflow name must stay Health gates');
expect(events?.pull_request !== undefined, 'pull_request trigger must remain present');
expect(events?.pull_request_review?.types?.includes('submitted'), 'pull_request_review submitted must trigger the workflow');
expect(events?.schedule !== undefined, 'schedule trigger must remain present');
expect(events?.workflow_dispatch !== undefined, 'workflow_dispatch trigger must remain present');
expect(
    decide?.if === "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'",
    'decide must run the heavy path only for approved pull_request_review submissions'
);
const allFalseScopes = { rust: 'false', server: 'false', e2e: 'false', web: 'false' };
const reviewScopes = { rust: 'false', server: 'true', e2e: 'false', web: 'true' };
const pullRequestScopes = { rust: 'true', server: 'false', e2e: 'true', web: 'false' };
expect(
    runResolveScope('schedule', allFalseScopes) === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\n',
    'schedule must enable the heavy path and every scope'
);
expect(
    runResolveScope('workflow_dispatch', allFalseScopes) === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\n',
    'workflow_dispatch must enable the heavy path and every scope'
);
expect(
    runResolveScope('pull_request_review', reviewScopes) === 'heavy=true\nrust=false\nserver=true\ne2e=false\nweb=true\n',
    'pull_request_review must enable the heavy path and preserve path-filter outputs'
);
expect(
    runResolveScope('pull_request', pullRequestScopes) === 'heavy=false\nrust=true\nserver=false\ne2e=true\nweb=false\n',
    'pull_request must disable the heavy path and preserve path-filter outputs'
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
    positiveControlRun.includes('cat > "$positive_control_repo/.gitleaks.toml"') &&
        positiveControlRun.includes('regexes = [\'\'\'.*\'\'\']') &&
        positiveControlRun.includes('git -C "$positive_control_repo" add synthetic-secret.txt .gitleaks.toml'),
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
expect(gate?.name === 'Gate', 'required Gate job name must stay exact');
expect(
    Array.isArray(gateNeeds) &&
        gateNeeds.length === expectedGateNeeds.length &&
        gateNeeds.every((need, index) => need === expectedGateNeeds[index]),
    `Gate needs must stay exactly: ${expectedGateNeeds.join(', ')}`
);
expect(!gateNeeds.includes('unit'), 'unit suite must remain outside required Gate needs');
expect(!gateNeeds.includes('e2e'), 'e2e suite must remain outside required Gate needs');
expect(!gateNeeds.includes('e2e-report'), 'e2e report must remain outside required Gate needs');

const maliciousHelperMarker = `${process.env.TEST_TEMP_ROOT}/pr-owned-helper-invoked.log`;
const workflowCommandLog = `${process.env.TEST_TEMP_ROOT}/workflow-secret-scan.log`;
writeFileSync(workflowCommandLog, '');
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
const trustedGitleaksPrefix = `gitleaks git --config ${process.env.TEST_TEMP_ROOT}/trusted-scanner/.gitleaks.toml --gitleaks-ignore-path ${process.env.TEST_TEMP_ROOT}/trusted-scanner/.gitleaksignore --no-banner --no-color --redact=100 --verbose`;
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
    "gitleaks git --config $temp_root/.gitleaks.toml --gitleaks-ignore-path $temp_root/.gitleaksignore --no-banner --no-color --redact=100 --verbose --exit-code=1 --log-opts=--all $gitleaks_target" \
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
    "gitleaks git --config $temp_root/.gitleaks.toml --gitleaks-ignore-path $temp_root/.gitleaksignore --no-banner --no-color --redact=100 --verbose --exit-code=79 --log-opts=--all $gitleaks_target" \
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
