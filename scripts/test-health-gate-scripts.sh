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
    'if [ "${1:-}" = "install" ]; then' \
    '    exit "${FAKE_INSTALL_STATUS:-0}"' \
    'fi' \
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
    'if [ "${1:-}" = "test:run" ] && [ "${2:-}" = "scripts/__tests__/fileTrackerIssue.spec.ts" ]; then' \
    '    exit "${FAKE_FILE_TRACKER_ISSUE_STATUS:-0}"' \
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
if [ "${FAKE_GITLEAKS_REQUIRE_MERGE_DIFF:-false}" = true ]; then
    case " $* " in
        *' --log-opts='*' -m '*) ;;
        *) exit 0 ;;
    esac
fi
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

WORKFLOW_PATH="$repo_root/.github/workflows/health-gates.yml" REPO_ROOT="$repo_root" TEST_TEMP_ROOT="$temp_root" FAKE_BIN="$fake_bin" node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(process.env.WORKFLOW_PATH, 'utf8'));
const gitleaksHelper = readFileSync(`${process.env.REPO_ROOT}/scripts/run-gitleaks-history-scan.sh`, 'utf8');
const gitleaksConfig = readFileSync(`${process.env.REPO_ROOT}/.gitleaks.toml`, 'utf8');
const smokeSpec = readFileSync(`${process.env.REPO_ROOT}/tests/e2e/smoke.spec.ts`, 'utf8');
const failures = [];

function expect(condition, message) {
    if (!condition) {
        failures.push(message);
    }
}

function stepNamed(job, name) {
    return job?.steps?.find((step) => step.name === name);
}

function runResolveScope(event, filters) {
    const outputPath = `${process.env.TEST_TEMP_ROOT}/resolve-scope-${event}.output`;
    writeFileSync(outputPath, '');
    const result = spawnSync('bash', ['-c', resolveScopeRun], {
        encoding: 'utf8',
        env: {
            ...process.env,
            EVENT: event,
            RUST: filters.rust,
            SERVER: filters.server,
            E2E: filters.e2e,
            WEB: filters.web,
            METADATA: filters.metadata,
            UNCLASSIFIED: filters.unclassified ?? 'false',
            GITHUB_OUTPUT: outputPath,
        },
    });
    expect(result.status === 0, `Resolve scope must execute for ${event}: ${result.stderr.trim()}`);
    return readFileSync(outputPath, 'utf8');
}

function matchesPathPattern(path, pattern) {
    let expression = '^';
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                expression += '.*';
                index += 1;
            } else {
                expression += '[^/]*';
            }
        } else {
            expression += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
        }
    }
    return new RegExp(`${expression}$`, 'u').test(path);
}

function matchesFilter(path, patterns) {
    if (!Array.isArray(patterns)) {
        return false;
    }
    const positivePatterns = patterns.filter((pattern) => !pattern.startsWith('!'));
    const excludedPatterns = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
    return (
        positivePatterns.some((pattern) => matchesPathPattern(path, pattern)) &&
        excludedPatterns.every((pattern) => !matchesPathPattern(path, pattern))
    );
}

function resolveChangedPathFilters(paths) {
    const filters = parse(pathFilters?.with?.filters ?? '');
    return Object.fromEntries(
        Object.entries(filters).map(([scope, patterns]) => [
            scope,
            paths.some((path) => matchesFilter(path, patterns)) ? 'true' : 'false',
        ])
    );
}

function parseScopeOutput(output) {
    return Object.fromEntries(
        output
            .trim()
            .split('\n')
            .map((line) => line.split('='))
            .map(([key, value]) => [key, value])
    );
}

function runGate(results) {
    return spawnSync('bash', ['-c', gateRun], {
        encoding: 'utf8',
        env: { ...process.env, RESULTS: JSON.stringify(results) },
    });
}

function terminalGateResults(defaultResult) {
    return Object.fromEntries(gateNeeds.map((job) => [job, { result: defaultResult }]));
}

function runWorkflowShell(label, body, env) {
    const result = runWorkflowShellResult(body, env);
    expect(result.status === 0, `${label} must execute outside the scan target: ${result.stderr.trim()}`);
    return result;
}

function runWorkflowShellResult(body, env) {
    const result = spawnSync('bash', ['-c', body], {
        cwd: process.env.TEST_TEMP_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    return result;
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
const pathFilters = stepNamed(decide, 'Filter changed paths');
const secrets = workflow.jobs?.secrets;
const prSecrets = workflow.jobs?.['pr-secrets'];
const releaseInventory = workflow.jobs?.['release-inventory'];
const staticChecks = workflow.jobs?.static;
const lint = workflow.jobs?.lint;
const boundaries = workflow.jobs?.boundaries;
const unit = workflow.jobs?.unit;
const smoke = workflow.jobs?.smoke;
const build = workflow.jobs?.build;
const rust = workflow.jobs?.rust;
const nativeMacos = workflow.jobs?.['native-macos'];
const nativeWindows = workflow.jobs?.['native-windows'];
const e2e = workflow.jobs?.e2e;
const dependencyReview = workflow.jobs?.['dependency-review'];
const gate = workflow.jobs?.gate;
const nightlyReport = workflow.jobs?.['nightly-report'];
const resolveScope = stepNamed(decide, 'Resolve scope');
const resolveScopeRun = resolveScope?.run ?? '';
const trustedCheckout = stepNamed(secrets, 'Checkout trusted scanner');
const targetCheckout = stepNamed(secrets, 'Checkout scan target');
const prTrustedCheckout = stepNamed(prSecrets, 'Checkout trusted scanner');
const prTargetCheckout = stepNamed(prSecrets, 'Checkout scan target');
const prTargetBaseFetch = stepNamed(prSecrets, 'Fetch immutable base SHA');
const prGitleaksInstall = stepNamed(prSecrets, 'Install trusted Gitleaks');
const prMergePositiveControl = stepNamed(prSecrets, 'Validate PR merge diff secret scanner');
const prSecretScan = stepNamed(prSecrets, 'Scan pull request diff for secrets');
const positiveControl = stepNamed(secrets, 'Validate secret scanner positive control');
const positiveControlRun = positiveControl?.run ?? '';
const secretScan = stepNamed(secrets, 'Scan history for secrets');
const secretScanRun = secretScan?.run ?? '';
const secretScanUses = secretScan?.uses ?? '';
const secretsEnv = secrets?.env ?? {};
const secretScanEnvJson = JSON.stringify([secretsEnv, positiveControl?.env ?? {}, secretScan?.env ?? {}]);
const unitRunStep = stepNamed(unit, 'Run shard');
const smokeRunStep = stepNamed(smoke, 'Run offline smoke set');
const e2eRunStep = stepNamed(e2e, 'Run shard');
const unitFailureWarning = stepNamed(unit, 'Report shard failure');
const e2eFailureWarning = stepNamed(e2e, 'Report shard failure');
const unitRun = unitRunStep?.run ?? '';
const smokeRun = smokeRunStep?.run ?? '';
const nightlyReportRun = stepNamed(nightlyReport, 'Open or update the nightly failure issue')?.run ?? '';
const gateRun = stepNamed(gate, 'Require every job to have succeeded or been skipped')?.run ?? '';
const gateNeeds = gate?.needs ?? [];
const expectedGateNeeds = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'dependency-review',
    'pr-secrets',
    'release-inventory',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'unit',
    'smoke',
    'e2e',
    'codeql',
    'secrets',
];
const checkoutSteps = Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) =>
    (job.steps ?? [])
        .filter((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
        .map((step) => ({ jobName, step }))
);

expect(workflow.name === 'Health gates', 'workflow name must stay Health gates');
expect(events?.pull_request !== undefined, 'pull_request trigger must remain present');
expect(events?.pull_request_review === undefined, 'pull_request_review must not start a duplicate Gate');
expect(events?.schedule !== undefined, 'schedule trigger must remain present');
expect(events?.workflow_dispatch !== undefined, 'workflow_dispatch trigger must remain present');
expect(
    JSON.stringify(workflow.permissions) === JSON.stringify({ contents: 'read' }),
    'workflow-level permissions must keep every job read-only by default'
);
expect(decide?.permissions?.contents === 'read', 'scope resolution must read repository contents');
expect(decide?.permissions?.['pull-requests'] === 'read', 'scope resolution must read pull-request file changes');
expect(
    JSON.stringify(Object.keys(decide?.permissions ?? {}).sort()) === JSON.stringify(['contents', 'pull-requests']),
    'scope resolution must receive only the repository and pull-request read permissions'
);
expect(decide?.outputs?.metadata === '${{ steps.scope.outputs.metadata }}', 'decide must publish the dedicated metadata scope');
expect(
    pathFilters?.with?.['predicate-quantifier'] === 'some-with-excludes',
    'path classification must use the pinned action documented some-with-excludes predicate'
);
const configuredPathFilters = parse(pathFilters?.with?.filters ?? '');
expect(
    configuredPathFilters.metadata?.includes('.github/ISSUE_TEMPLATE/**'),
    'issue templates must have a dedicated metadata scope'
);
expect(
    !configuredPathFilters.web?.includes('.github/ISSUE_TEMPLATE/**'),
    'issue templates must not trigger web compilation work'
);
expect(configuredPathFilters.documentation === undefined, 'path classification must not retain a redundant documentation filter');
expect(configuredPathFilters.non_document === undefined, 'path classification must not retain a redundant non-document filter');
for (const scope of ['rust', 'server', 'e2e', 'web']) {
    expect(configuredPathFilters[scope]?.includes('!*.md'), `${scope} path classification must exclude root Markdown`);
    expect(configuredPathFilters[scope]?.includes('!**/*.md'), `${scope} path classification must exclude nested Markdown`);
}
expect(resolveScope?.env?.NON_DOCUMENT === undefined, 'scope resolution must not retain a redundant non-document output');
expect(!resolveScopeRun.includes('NON_DOCUMENT'), 'scope resolution must let unclassified alone force every fast scope');
for (const scope of ['RUST', 'SERVER', 'E2E', 'WEB', 'METADATA', 'UNCLASSIFIED']) {
    expect(
        resolveScope?.env?.[scope] === `\${{ steps.filter.outputs.${scope.toLowerCase()} }}`,
        `Resolve scope ${scope} binding must map to its matching dorny output`
    );
}
expect(smokeSpec.includes("test.use({ serviceWorkers: 'block' });"), 'offline smoke must block service workers before routing requests');
expect(
    smokeSpec.includes("import { stringify as superjsonStringify } from 'superjson';") &&
        smokeSpec.includes('const MANUAL_SAVE_PREFERENCES = superjsonStringify({ autoSave: false });') &&
        smokeSpec.includes("localStorage: [{ name: 'sourdaw-preferences', value: MANUAL_SAVE_PREFERENCES }]") &&
        smokeSpec.indexOf("localStorage: [{ name: 'sourdaw-preferences', value: MANUAL_SAVE_PREFERENCES }]") <
            smokeSpec.indexOf('await launch_new_project(page);'),
    'offline smoke must disable autosave through a valid superjson preferences value before first navigation'
);
expect(smokeSpec.includes("await page.routeWebSocket('**/*'"), 'offline smoke must route WebSockets before navigation');
expect(smokeSpec.includes("await webSocket.close({ code: 1008, reason: 'External network blocked' });"), 'offline smoke must close every external WebSocket');
expect(smokeSpec.includes('const OFFLINE_IDLE_WINDOW_MS = 500;'), 'offline smoke must use one named 500 ms quiescence window');
expect(
    smokeSpec.includes('async function blockExternalRequests(page: Page): Promise<() => Promise<void>>') &&
        smokeSpec.includes('return async () => {') &&
        smokeSpec.includes('await page.waitForTimeout(OFFLINE_IDLE_WINDOW_MS);'),
    'offline assertions must wait through the bounded idle window before inspecting captured endpoints'
);
expect(
    smokeSpec.includes('async function openNewProject(page: Page): Promise<() => Promise<void>>'),
    'new-project setup must preserve the await-required offline assertion callback type'
);
const awaitedOfflineAssertions = smokeSpec.match(/await (?:reopened\.)?assertOffline\(\);/gu) ?? [];
const offlineAssertions = smokeSpec.match(/(?:reopened\.)?assertOffline\(\);/gu) ?? [];
expect(awaitedOfflineAssertions.length === 6, 'every offline assertion must be awaited after the last visible action or assertion');
expect(
    awaitedOfflineAssertions.length === offlineAssertions.length,
    'offline smoke must not retain a synchronous endpoint snapshot'
);
expect(
    (smokeSpec.match(/await startBlankProject\(page\);\n        await assertOffline\(\);\n\n        const reopened = await openSavedProjectInFreshPage/gu) ?? [])
        .length === 2,
    'each persistence smoke must finish original-page offline coverage before handing off to a fresh renderer'
);
expect(smokeSpec.includes('await page.addInitScript(() => {'), 'playback smoke must install AudioContext instrumentation before navigation');
expect(smokeSpec.includes('const nativeResume = AudioContext.prototype.resume;'), 'playback smoke must wrap the native AudioContext resume method');
expect(smokeSpec.includes('await nativeResume.call(this);'), 'playback smoke must await the native AudioContext resume method');
expect(
    smokeSpec.includes('document.documentElement.dataset.audioContextResumeState = this.state;'),
    'playback smoke must publish the resumed AudioContext state through a test-only dataset signal'
);
expect(
    smokeSpec.includes('let observedAudioContext: AudioContext | undefined;') &&
        smokeSpec.includes("document.addEventListener('sourdaw-test-suspend-audio-context'") &&
        smokeSpec.includes('await observedAudioContext.suspend();'),
    'playback smoke must capture and suspend its real AudioContext through a document-only test control'
);
expect(
    smokeSpec.includes('const nativeCreateGain = AudioContext.prototype.createGain;') &&
        smokeSpec.includes('AudioContext.prototype.createGain = function (this: AudioContext): GainNode {') &&
        smokeSpec.includes('return nativeCreateGain.call(this);'),
    'playback smoke must capture the real AudioContext at engine gain creation and delegate faithfully'
);
expect(
    smokeSpec.includes("document.addEventListener('sourdaw-test-read-audio-context-state'") &&
        smokeSpec.includes("document.documentElement.dataset.audioContextResumeState = observedAudioContext?.state ?? 'missing';") &&
        smokeSpec.includes("document.dispatchEvent(new Event('sourdaw-test-read-audio-context-state'))"),
    'every playback state assertion must request the captured AudioContext live state through the document control'
);
expect(smokeSpec.includes('const nativeStart = OscillatorNode.prototype.start;'), 'playback smoke must observe the production oscillator scheduling boundary');
expect(smokeSpec.includes('document.documentElement.dataset.scheduledOscillatorCount'), 'playback smoke must expose scheduled oscillator count through a test-only dataset signal');
expect(smokeSpec.includes('await createPlayableMidiClip(page);'), 'playback smoke must create deterministic playable MIDI material before transport starts');
expect(smokeSpec.includes("toHaveText('1 note')"), 'playback smoke must assert that the playable clip contains one MIDI note');
expect(
    smokeSpec.includes("await timeline.click({ button: 'right', position: { x: 30, y } });") &&
        smokeSpec.includes('await timeline.dblclick({ position: { x: 30, y } });') &&
        smokeSpec.includes('await pianoRoll.click({ position: { x: 40, y: 130 } });') &&
        !smokeSpec.includes('position: { x: 300, y }') &&
        !smokeSpec.includes('position: { x: 200, y: 130 }') &&
        smokeSpec.indexOf('await createPlayableMidiClip(page);') < smokeSpec.indexOf('await play.click();'),
    'playback smoke must place its clip and note near beat zero before Play'
);
expect(
    smokeSpec.indexOf('await scheduledOscillators.reset();') > smokeSpec.indexOf('await createPlayableMidiClip(page);') &&
        smokeSpec.indexOf('await scheduledOscillators.reset();') < smokeSpec.indexOf('await play.click();') &&
        smokeSpec.indexOf('await expect.poll(scheduledOscillators.count).toBe(0);') < smokeSpec.indexOf('await play.click();'),
    'playback smoke must reset and prove the scheduling counter empty after note-entry auditioning and before Play'
);
expect(
    smokeSpec.includes(
        'const audioContext = await observeAudioContextResumeState(page);\n' +
            '        const scheduledOscillators = await observeScheduledOscillatorCount(page);\n' +
            '        const assertOffline = await openNewProject(page);'
    ),
    'playback smoke must install AudioContext instrumentation before project navigation'
);
expect(
    smokeSpec.indexOf('expect.poll(scheduledOscillators.count).toBeGreaterThan(0)') > smokeSpec.indexOf('await play.click();'),
    'playback smoke must observe transport scheduling only after clicking Play'
);
expect(
    smokeSpec.indexOf('await audioContext.suspend();') < smokeSpec.indexOf('await play.click();') &&
        smokeSpec.indexOf("expect.poll(audioContext.resumeState).toBe('suspended')") < smokeSpec.indexOf('await play.click();') &&
        smokeSpec.indexOf("expect.poll(audioContext.resumeState).toBe('running')") > smokeSpec.indexOf('await play.click();'),
    'playback smoke must require Play to resume the deliberately suspended context'
);
expect(!smokeSpec.includes('Object.defineProperty(window'), 'playback smoke must not expose AudioContext observations on window');
expect(!smokeSpec.includes('Reflect.get(window'), 'playback smoke must not read AudioContext observations from window');
expect(!smokeSpec.includes('resumeStates'), 'playback smoke must not retain the AudioContext resume-state array seam');
const freshPageHelper = smokeSpec.slice(
    smokeSpec.indexOf('async function openSavedProjectInFreshPage'),
    smokeSpec.indexOf("test.describe('Offline project smoke'")
);
expect(
    freshPageHelper.includes('async function openSavedProjectInFreshPage(page: Page, name: string)') &&
        freshPageHelper.includes('const browserContext = page.context();') &&
        freshPageHelper.includes('const reopenedPage = await browserContext.newPage();') &&
        freshPageHelper.indexOf('await page.close();') < freshPageHelper.indexOf('const reopenedPage = await browserContext.newPage();') &&
        freshPageHelper.includes('await reopenedPage.goto(appRootUrl);') &&
        freshPageHelper.includes("await expect(projectName).toHaveText('Untitled Project', { timeout: 30_000 });") &&
        freshPageHelper.includes('await expect(projectName).not.toHaveText(name);') &&
        freshPageHelper.includes('await expect(projectName).toHaveText(name, { timeout: 30_000 });') &&
        freshPageHelper.lastIndexOf('await wait_for_workspace_ready(reopenedPage);') >
            freshPageHelper.indexOf('await expect(projectName).toHaveText(name, { timeout: 30_000 });'),
    'persistence smoke must reopen saved IndexedDB truth in a fresh renderer page within the existing browser context'
);
expect(
    (smokeSpec.match(/await startBlankProject\(page\);/gu) ?? []).length === 2 &&
        (smokeSpec.match(/await expect\(dirtyIndicator\(page\)\)\.toHaveCount\(0\);\n        await startBlankProject\(page\);/gu) ?? [])
            .length === 2,
    'persistence smokes must prove manual save clean before switching to a distinct blank project'
);
expect(
    smokeSpec.includes("await expect(page.getByTestId('project-name')).toHaveText('Untitled Project');") &&
        smokeSpec.includes("await expect(page.getByText('Add your first track')).toBeVisible();") &&
        smokeSpec.includes("await expect(page.getByRole('grid', { name: /Track list/i })).toHaveCount(0);"),
    'blank-project transition must prove a distinct untitled empty project before fresh-renderer reload'
);
expect(
    !smokeSpec.includes("reopened.page.getByRole('button', { name: 'Smoke") &&
        (smokeSpec.match(/reopened\.page\.getByTestId\('project-name'\)/gu) ?? []).length === 2,
    'persistence smoke project-name assertions must use the stable project-name test id'
);
expect(
    !smokeSpec.includes('storageState(') && !smokeSpec.includes('browser.newContext(') && !smokeSpec.includes('openSavedProjectInFreshContext'),
    'persistence smoke must not serialize unsupported IndexedDB stores into a new browser context'
);
expect(
    (smokeSpec.match(/await reopened\.page\.close\(\);/gu) ?? []).length === 2 && !smokeSpec.includes('reopened.context.close()'),
    'each persistence smoke must close only its fresh renderer page'
);
expect(
    checkoutSteps.length > 0 && checkoutSteps.every(({ step }) => step.with?.['persist-credentials'] === false),
    `every actions/checkout step must disable persisted credentials: ${checkoutSteps.map(({ jobName, step }) => `${jobName}/${step.name ?? 'unnamed'}`).join(', ')}`
);
expect(
    concurrency?.group === "health-gates-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}",
    'only pull_request runs may share a PR-number concurrency group'
);
expect(
    concurrency?.['cancel-in-progress'] === "${{ github.event_name == 'pull_request' }}",
    'concurrency cancellation must apply only to pull_request runs'
);
expect(decide?.if === undefined, 'decide must not retain a dead review predicate');
const allFalseScopes = { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' };
expect(
    runResolveScope('schedule', allFalseScopes) === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\nmetadata=true\n',
    'schedule must enable the heavy path and every scope'
);
expect(
    runResolveScope('workflow_dispatch', allFalseScopes) === 'heavy=true\nrust=true\nserver=true\ne2e=true\nweb=true\nmetadata=true\n',
    'workflow_dispatch must enable the heavy path and every scope'
);
const codeBearingIf =
    "needs.decide.outputs.web == 'true' || needs.decide.outputs.rust == 'true' || needs.decide.outputs.server == 'true' || needs.decide.outputs.e2e == 'true'";
expect(staticChecks?.if === codeBearingIf, 'types and contracts must skip documentation-only pull requests');
expect(lint?.if === codeBearingIf, 'lint must skip documentation-only pull requests');
expect(boundaries?.if === codeBearingIf, 'module boundaries must skip documentation-only pull requests');
expect(unit?.if === "needs.decide.outputs.web == 'true'", 'unit suite must remain scoped to web-related changes');
expect(smoke?.if === "github.event_name == 'pull_request' && needs.decide.outputs.e2e == 'true'", 'offline smoke must run only on applicable fast pull-request heads');
expect(build?.if === "needs.decide.outputs.web == 'true'", 'production build must remain scoped to web-related changes');
expect(
    rust?.if === "needs.decide.outputs.rust == 'true' || needs.decide.outputs.server == 'true'",
    'Rust workspace must remain scoped to Rust or server changes'
);
expect(nativeMacos?.if === "needs.decide.outputs.rust == 'true'", 'macOS native leg must remain scoped to Rust changes');
expect(nativeWindows?.if === "needs.decide.outputs.rust == 'true'", 'Windows native leg must remain scoped to Rust changes');
expect(dependencyReview?.if === "github.event_name == 'pull_request'", 'dependency review must remain limited to pull-request events');
expect(prSecrets?.if === "github.event_name == 'pull_request'", 'PR diff secret scan must run only for pull-request events');
expect(
    releaseInventory?.if ===
        "github.event_name == 'pull_request' && needs.decide.outputs.web != 'true' && needs.decide.outputs.rust != 'true' && needs.decide.outputs.server != 'true' && needs.decide.outputs.e2e != 'true'",
    'release inventory must run only for non-code pull requests'
);
expect(releaseInventory?.name === 'Release inventory', 'documentation-only release inventory job must remain present');
expect(releaseInventory?.['runs-on'] === 'ubuntu-latest', 'documentation-only release inventory must run on a hosted Linux runner');
const releaseInventoryNode = stepNamed(releaseInventory, 'Set up Node');
expect(releaseInventoryNode?.with?.['node-version'] === '${{ env.NODE_VERSION }}', 'non-code release inventory must use the workflow-pinned Node runtime');
expect(stepNamed(releaseInventory, 'Enable Corepack')?.run === 'corepack enable', 'non-code release inventory must enable Corepack');
expect(stepNamed(releaseInventory, 'Install dependencies')?.run === 'pnpm install --frozen-lockfile', 'non-code release inventory must install the frozen dependency graph');
expect(
    stepNamed(releaseInventory, 'Validate release inventory')?.run === 'pnpm test:release-inventory',
    'non-code release inventory must invoke the project-native script'
);
const releaseMetadataContractStep = stepNamed(releaseInventory, 'Validate issue-template contract');
const staticMetadataContractStep = stepNamed(staticChecks, 'Validate issue-template contract');
for (const [jobName, step] of [
    ['release-inventory', releaseMetadataContractStep],
    ['static', staticMetadataContractStep],
]) {
    expect(
        step?.run === 'pnpm test:run scripts/__tests__/fileTrackerIssue.spec.ts',
        `${jobName} metadata changes must execute the focused fileTrackerIssue contract`
    );
    expect(step?.if === "needs.decide.outputs.metadata == 'true'", `${jobName} metadata contract must run exactly for the metadata scope`);
}
const nonCodeCommandLog = `${process.env.TEST_TEMP_ROOT}/non-code-release-inventory.log`;
const releaseInstallRun = stepNamed(releaseInventory, 'Install dependencies')?.run ?? '';
const releaseInventoryRun = stepNamed(releaseInventory, 'Validate release inventory')?.run ?? '';
const metadataContractRun = releaseMetadataContractStep?.run ?? '';
writeFileSync(nonCodeCommandLog, '');
const missingNonCodeDependencies = runWorkflowShellResult(`set -e\n${releaseInstallRun}\n${releaseInventoryRun}`, {
    COMMAND_LOG: nonCodeCommandLog,
    FAKE_INSTALL_STATUS: '53',
    PATH: `${process.env.FAKE_BIN}:${process.env.PATH}`,
});
expect(missingNonCodeDependencies.status === 53, 'missing non-code dependencies must stop release inventory before it runs');
expect(readFileSync(nonCodeCommandLog, 'utf8') === 'pnpm install --frozen-lockfile\n', 'non-code dependency failure must run only the frozen install command');
writeFileSync(nonCodeCommandLog, '');
const brokenMetadataContract = runWorkflowShellResult(`set -e\n${releaseInventoryRun}\n${metadataContractRun}`, {
    COMMAND_LOG: nonCodeCommandLog,
    FAKE_FILE_TRACKER_ISSUE_STATUS: '61',
    PATH: `${process.env.FAKE_BIN}:${process.env.PATH}`,
});
expect(brokenMetadataContract.status === 61, 'broken focused metadata contract must fail the non-code job');
expect(
    readFileSync(nonCodeCommandLog, 'utf8') ===
        'pnpm test:release-inventory\npnpm test:run scripts/__tests__/fileTrackerIssue.spec.ts\n',
    'metadata-only execution must run release inventory and only the focused fileTrackerIssue spec'
);
expect(e2e?.if === "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'", 'full E2E must require the scheduled or dispatched heavy path');
expect(e2e?.strategy?.matrix?.shard?.length === 12, 'full E2E must retain all twelve shards');
expect(
    smokeRun === 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0',
    'fast PR smoke must run only the deterministic smoke spec and fail on its first failure'
);
expect(e2eRunStep?.run === 'pnpm test:e2e --shard=${{ matrix.shard }}/12 --reporter=blob', 'scheduled/manual E2E must run the full twelve-shard suite rather than a duplicate smoke job');

function startedPullRequestJobs(scopes) {
    const jobs = ['decide', 'dependency-review', 'pr-secrets'];
    const codeBearing = scopes.web === 'true' || scopes.rust === 'true' || scopes.server === 'true' || scopes.e2e === 'true';
    if (codeBearing) jobs.push('static', 'lint', 'boundaries');
    if (scopes.web === 'true') jobs.push('unit', 'build');
    if (scopes.e2e === 'true') jobs.push('smoke');
    if (scopes.rust === 'true' || scopes.server === 'true') jobs.push('rust');
    if (scopes.rust === 'true') jobs.push('native-macos', 'native-windows');
    if (!codeBearing) {
        jobs.push('release-inventory');
    }
    jobs.push('gate');
    return jobs;
}

function metadataContractJobs(scopes) {
    if (scopes.metadata !== 'true') return [];
    const codeBearing = scopes.web === 'true' || scopes.rust === 'true' || scopes.server === 'true' || scopes.e2e === 'true';
    return codeBearing ? ['static'] : ['release-inventory'];
}

for (const fixture of [
    {
        name: 'TypeScript-only',
        paths: ['src/modules/Project/useCases/createFreshProjectMetadata.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'unit', 'build', 'smoke', 'gate'],
        metadataContractJobs: [],
    },
    {
        name: 'test-only',
        paths: ['tests/e2e/smoke.spec.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'true', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'smoke', 'gate'],
    },
    {
        name: 'Rust-only',
        paths: ['crates/daw-core/src/lib.rs'],
        unclassified: 'false',
        scopes: { rust: 'true', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'rust', 'native-macos', 'native-windows', 'gate'],
    },
    {
        name: 'Electron-only',
        paths: ['electron/appIpc.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'true', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'unit', 'build', 'gate'],
    },
    {
        name: 'server-only',
        paths: ['server/collab-server.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'true', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'rust', 'gate'],
    },
    {
        name: 'Vite config',
        paths: ['vite.config.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'unit', 'build', 'smoke', 'rust', 'gate'],
    },
    {
        name: 'Playwright config',
        paths: ['playwright.config.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'true', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'smoke', 'gate'],
    },
    {
        name: 'Vitest collection scope script',
        paths: ['scripts/checkVitestCollectionScope.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'true', e2e: 'false', web: 'true', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'unit', 'build', 'rust', 'gate'],
    },
    {
        name: 'server health-gate script',
        paths: ['scripts/health-gates-server.sh'],
        unclassified: 'false',
        scopes: { rust: 'true', server: 'true', e2e: 'false', web: 'true', metadata: 'false' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'rust',
            'native-macos',
            'native-windows',
            'gate',
        ],
    },
    {
        name: 'shared package manifest',
        paths: ['package.json'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'static', 'lint', 'boundaries', 'unit', 'build', 'smoke', 'rust', 'gate'],
    },
    {
        name: 'workflow-only',
        paths: ['.github/workflows/health-gates.yml'],
        unclassified: 'false',
        scopes: { rust: 'true', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'smoke',
            'rust',
            'native-macos',
            'native-windows',
            'gate',
        ],
    },
    {
        name: 'documentation-only',
        paths: ['docs/06-testing.md'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
        metadataContractJobs: [],
    },
    {
        name: 'nested Markdown under Rust code',
        paths: ['crates/daw-core/AGENTS.md'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
    },
    {
        name: 'nested Markdown under server code',
        paths: ['server/AGENTS.md'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
    },
    {
        name: 'nested Markdown under shared runtime code',
        paths: ['src/app/AGENTS.md'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
    },
    {
        name: 'nested Markdown under desktop code',
        paths: ['electron/AGENTS.md'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'false' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
    },
    {
        name: 'issue-template-only',
        paths: ['.github/ISSUE_TEMPLATE/bug_report.yml'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'true' },
        jobs: ['decide', 'dependency-review', 'pr-secrets', 'release-inventory', 'gate'],
        metadataContractJobs: ['release-inventory'],
    },
    {
        name: 'mixed issue-template and TypeScript code',
        paths: ['.github/ISSUE_TEMPLATE/bug_report.yml', 'src/modules/Project/useCases/createFreshProjectMetadata.ts'],
        unclassified: 'false',
        scopes: { rust: 'false', server: 'false', e2e: 'true', web: 'true', metadata: 'true' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'smoke',
            'gate',
        ],
        metadataContractJobs: ['static'],
    },
    {
        name: 'unclassified root code',
        paths: ['.dependency-cruiser.shared.cjs'],
        unclassified: 'true',
        scopes: { rust: 'true', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'smoke',
            'rust',
            'native-macos',
            'native-windows',
            'gate',
        ],
    },
    {
        name: 'mixed documentation and unclassified code',
        paths: ['docs/06-testing.md', '.dependency-cruiser.shared.cjs'],
        unclassified: 'true',
        scopes: { rust: 'true', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'smoke',
            'rust',
            'native-macos',
            'native-windows',
            'gate',
        ],
    },
    {
        name: 'mixed known and unclassified code',
        paths: ['src/modules/Project/useCases/createFreshProjectMetadata.ts', '.dependency-cruiser.shared.cjs'],
        unclassified: 'true',
        scopes: { rust: 'true', server: 'true', e2e: 'true', web: 'true', metadata: 'false' },
        jobs: [
            'decide',
            'dependency-review',
            'pr-secrets',
            'static',
            'lint',
            'boundaries',
            'unit',
            'build',
            'smoke',
            'rust',
            'native-macos',
            'native-windows',
            'gate',
        ],
    },
]) {
    const filters = resolveChangedPathFilters(fixture.paths);
    expect(filters.unclassified === fixture.unclassified, `${fixture.name} must classify unknown paths independently`);
    const scopeOutput = parseScopeOutput(runResolveScope('pull_request', filters));
    expect(scopeOutput.heavy === 'false', `${fixture.name} pull_request must not enable the heavy path`);
    for (const [scope, value] of Object.entries(fixture.scopes)) {
        expect(scopeOutput[scope] === value, `${fixture.name} must resolve ${scope} to ${value}`);
    }
    expect(
        JSON.stringify(startedPullRequestJobs(fixture.scopes)) === JSON.stringify(fixture.jobs),
        `${fixture.name} must start only its applicable jobs and terminal Gate`
    );
    if (fixture.metadataContractJobs !== undefined) {
        expect(
            JSON.stringify(metadataContractJobs(fixture.scopes)) === JSON.stringify(fixture.metadataContractJobs),
            `${fixture.name} must run the focused issue-template contract only in ${fixture.metadataContractJobs.join(', ') || 'no job'}`
        );
    }
    const results = terminalGateResults('skipped');
    for (const job of fixture.jobs) {
        if (job !== 'gate' && gateNeeds.includes(job)) {
            results[job] = { result: 'success' };
        }
    }
    const gateResult = runGate(results);
    expect(gateResult.status === 0, `${fixture.name} terminal Gate must pass with successful and skipped dependencies`);
    expect(gateResult.stdout.endsWith('every job succeeded or was skipped\n'), `${fixture.name} terminal Gate must report its successful conclusion`);
}
for (const codeScope of ['web', 'rust', 'server', 'e2e']) {
    const scopes = { rust: 'false', server: 'false', e2e: 'false', web: 'false', metadata: 'true', [codeScope]: 'true' };
    expect(
        JSON.stringify(metadataContractJobs(scopes)) === JSON.stringify(['static']),
        `metadata mixed with ${codeScope} code must use the existing static job only`
    );
}
expect(secrets?.if === "needs.decide.outputs.heavy == 'true'", 'secrets job must remain on the heavy path');
expect(prSecrets?.name === 'PR diff secret scan', 'PR diff secret scan job must remain present');
expect(prSecrets?.needs?.includes('decide'), 'PR diff secret scan must wait for scope decision');
expect(prSecrets?.env?.GITLEAKS_VERSION === '8.30.1', 'PR diff secret scan must use the trusted pinned Gitleaks version');
expect(
    prSecrets?.env?.GITLEAKS_SHA256 === '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    'PR diff secret scan must use the trusted pinned Gitleaks digest'
);
expect(prSecrets?.env?.BASE_SHA === '${{ github.event.pull_request.base.sha }}', 'PR diff secret scan must use the immutable base SHA');
expect(prSecrets?.env?.HEAD_SHA === '${{ github.event.pull_request.head.sha }}', 'PR diff secret scan must use the immutable head SHA');
expect(prTrustedCheckout?.with?.ref === '${{ github.event.pull_request.base.sha }}', 'PR diff secret scan must read scanner inputs from the immutable base SHA');
expect(prTrustedCheckout?.with?.path === 'trusted-scanner', 'PR diff secret scan must isolate trusted scanner inputs');
expect(prTrustedCheckout?.with?.['persist-credentials'] === false, 'PR diff trusted scanner checkout must not persist credentials');
expect(prTargetCheckout?.with?.ref === '${{ github.event.pull_request.head.sha }}', 'PR diff secret scan must read the immutable head SHA');
expect(prTargetCheckout?.with?.repository === undefined, 'PR diff target checkout must retain the base repository as its origin for fork PRs');
expect(prTargetCheckout?.with?.path === 'scan-target', 'PR diff secret scan must isolate the untrusted target');
expect(prTargetCheckout?.with?.['fetch-depth'] === 0, 'PR diff secret scan must fetch the base-to-head history');
expect(prTargetCheckout?.with?.['persist-credentials'] === false, 'PR diff target checkout must not persist credentials');
expect(prTargetBaseFetch?.['working-directory'] === 'scan-target', 'PR diff secret scan must fetch the base SHA into the scan target repository');
expect(prTargetBaseFetch?.run === 'git fetch --no-tags --depth=1 origin "$BASE_SHA"', 'PR diff secret scan must fetch the immutable base SHA from the base repository origin');
const prSecretScanRun = prSecretScan?.run ?? '';
expect(prSecretScan?.['working-directory'] === '${{ github.workspace }}', 'PR diff secret scan must run outside the untrusted checkout');
expect(prSecretScanRun.includes("--config \"$GITHUB_WORKSPACE/trusted-scanner/.gitleaks.toml\""), 'PR diff secret scan must use the trusted Gitleaks configuration');
expect(prSecretScanRun.includes("--gitleaks-ignore-path \"$GITHUB_WORKSPACE/trusted-scanner/.gitleaksignore\""), 'PR diff secret scan must use the trusted Gitleaks ignore file');
expect(prSecretScanRun.includes('--ignore-gitleaks-allow'), 'PR diff secret scan must reject PR-authored gitleaks:allow annotations');
expect(prSecretScanRun.includes('--log-opts="$BASE_SHA..$HEAD_SHA -m"'), 'PR diff secret scan must scan merge diffs only within the immutable base-to-head range');
expect(!prSecretScanRun.includes('--log-opts=--all'), 'PR diff secret scan must not duplicate the full-history scan');
expect(prGitleaksInstall?.run?.includes('sha256sum --check --status'), 'PR diff secret scan must verify its downloaded binary digest before scanning');
expect(prGitleaksInstall?.run?.includes('>> "$GITHUB_PATH"'), 'PR diff secret scanner must make only the verified binary available to later steps');
const prMergePositiveControlRun = prMergePositiveControl?.run ?? '';
expect(prMergePositiveControl?.env?.GITLEAKS_EXPECTED_LEAK_EXIT_CODE === 79, 'PR merge-diff positive control must require a distinct leak exit code');
expect(prMergePositiveControlRun.includes('merge --no-ff fixture-branch'), 'PR merge-diff positive control must create a real merge commit');
expect(prMergePositiveControlRun.includes('--log-opts="$base_sha..$head_sha -m"'), 'PR merge-diff positive control must include merge diffs');
expect(prMergePositiveControlRun.includes('positive_control_status'), 'PR merge-diff positive control must fail closed when no secret is found');
expect(!prSecretScanRun.includes('|| true'), 'PR diff scanner must not suppress a nonzero scanner result');
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
expect(secretScanUses === '', 'secret scan must not use gitleaks-action, which cannot scan the trusted checkout layout');
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
    prMergePositiveControlRun.includes('if [ "$positive_control_status" -ne "$GITLEAKS_EXPECTED_LEAK_EXIT_CODE" ]; then'),
    'PR merge-diff positive control must fail when the scanner does not report its synthetic secret'
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
    unitRunStep?.['continue-on-error'] === undefined,
    'unit Run shard must fail its job on every event so Gate observes a failed unit dependency'
);
expect(
    e2eRunStep?.['continue-on-error'] === undefined,
    'end-to-end Run shard must fail its job on every event so Gate observes a failed end-to-end dependency'
);
expect(smoke?.name === 'Offline browser smoke', 'offline smoke job must remain present');
expect(smoke?.if === "github.event_name == 'pull_request' && needs.decide.outputs.e2e == 'true'", 'offline smoke must run only for applicable fast pull-request heads');
expect(
    smokeRun === 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0',
    'offline smoke must run only the deterministic smoke spec and fail on its first failure'
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
const gateName =
    "${{ github.event_name == 'workflow_dispatch' && github.ref != format('refs/heads/{0}', github.event.repository.default_branch) && 'Manual health gate' || 'Gate' }}";
expect(
    gate?.name === gateName,
    'non-default workflow_dispatch must resolve the aggregate job display name to Manual health gate, not Gate'
);
function expectedGateDisplayName(event, ref, defaultBranch) {
    if (event === 'workflow_dispatch' && ref !== `refs/heads/${defaultBranch}`) {
        return 'Manual health gate';
    }
    return 'Gate';
}
expect(expectedGateDisplayName('pull_request', 'refs/pull/2870/merge', 'main') === 'Gate', 'pull_request must report exactly Gate');
expect(expectedGateDisplayName('schedule', 'refs/heads/main', 'main') === 'Gate', 'schedule must report exactly Gate');
expect(expectedGateDisplayName('workflow_dispatch', 'refs/heads/main', 'main') === 'Gate', 'default-branch dispatch must report exactly Gate');
expect(
    expectedGateDisplayName('workflow_dispatch', 'refs/heads/repair-gate', 'main') === 'Manual health gate',
    'non-default workflow_dispatch must not report Gate'
);
expect(gate?.if === '${{ always() }}', 'aggregate shell must run and evaluate dependencies for every event');
expect(
    Array.isArray(gateNeeds) &&
        gateNeeds.length === expectedGateNeeds.length &&
        gateNeeds.every((need, index) => need === expectedGateNeeds[index]),
    `Gate needs must stay exactly: ${expectedGateNeeds.join(', ')}`
);
expect(gateNeeds.includes('unit'), 'full unit suite must contribute to Gate');
expect(gateNeeds.includes('smoke'), 'offline browser smoke must contribute to Gate');
expect(gateNeeds.includes('e2e'), 'scheduled full end-to-end suite must contribute to Gate');
expect(!gateNeeds.includes('e2e-report'), 'e2e report must remain outside required Gate needs');
expect(
    stepNamed(gate, 'Require every job to have succeeded or been skipped')?.env?.RESULTS === '${{ toJSON(needs) }}',
    'Gate must bind RESULTS exactly to every declared need result'
);
expect(
    gateRun.includes('select(.value.result != "success" and .value.result != "skipped")') &&
        gateRun.includes('if [ -n "$failed" ]; then') &&
        gateRun.includes('exit 1') &&
        gateRun.includes("printf 'every job succeeded or was skipped\\n'"),
    'Gate must keep rejecting failed dependencies while accepting successful or skipped dependencies'
);
for (const fixture of [
    { name: 'success', result: 'success', expectedStatus: 0, expectedOutput: 'every job succeeded or was skipped\n' },
    { name: 'skipped', result: 'skipped', expectedStatus: 0, expectedOutput: 'every job succeeded or was skipped\n' },
    { name: 'static/type failure', job: 'static', result: 'failure', expectedStatus: 1, expectedOutput: 'failing jobs:\nstatic: failure\n' },
    { name: 'unit failure', job: 'unit', result: 'failure', expectedStatus: 1, expectedOutput: 'failing jobs:\nunit: failure\n' },
    { name: 'build failure', job: 'build', result: 'failure', expectedStatus: 1, expectedOutput: 'failing jobs:\nbuild: failure\n' },
    { name: 'native failure', job: 'native-macos', result: 'failure', expectedStatus: 1, expectedOutput: 'failing jobs:\nnative-macos: failure\n' },
    { name: 'cancelled', job: 'smoke', result: 'cancelled', expectedStatus: 1, expectedOutput: 'failing jobs:\nsmoke: cancelled\n' },
]) {
    const results = terminalGateResults(fixture.expectedStatus === 0 ? fixture.result : 'skipped');
    if (fixture.job) results[fixture.job] = { result: fixture.result };
    const result = runGate(results);
    expect(result.status === fixture.expectedStatus, `Gate ${fixture.name} fixture must exit ${fixture.expectedStatus}`);
    expect(result.stdout.endsWith(fixture.expectedOutput), `Gate ${fixture.name} fixture must report its exact terminal outcome`);
}
expect(nightlyReport?.name === 'Nightly failure report', 'nightly report job must remain present');
expect(nightlyReport?.needs?.includes('smoke'), 'nightly report must observe offline smoke failures');
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
    RESULTS: '{"static":{"result":"success"},"smoke":{"result":"failure"}}',
    RUN_URL: 'nightly-run-123',
};
writeFileSync(nightlyIssueLog, '');
runWorkflowShell('nightly report existing issue', nightlyReportRun, { ...nightlyReportEnv, GH_ISSUE_MODE: 'existing' });
const existingIssueCommands = readFileSync(nightlyIssueLog, 'utf8').trim().split('\n');
expect(existingIssueCommands.some((command) => command.startsWith('issue list ') && command.includes(`--repo ${fixtureRepository}`)), 'existing path must list issues in the repository');
expect(existingIssueCommands.some((command) => command.startsWith('issue comment 42 ') && command.includes(`--repo ${fixtureRepository}`)), 'existing path must comment on the existing issue in the repository');
expect(existingIssueCommands.some((command) => command.includes('Failing jobs: smoke')), 'nightly report must name an offline smoke failure');
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
writeFileSync(workflowCommandLog, '');
const gitleaksPath = `${process.env.TEST_TEMP_ROOT}/github-path`;
writeFileSync(gitleaksPath, '');
runWorkflowShell('PR trusted Gitleaks install', prGitleaksInstall?.run ?? '', {
    ...workflowShellEnv,
    GITHUB_PATH: gitleaksPath,
});
const installedGitleaksDir = readFileSync(gitleaksPath, 'utf8').trim();
const prWorkflowEnv = {
    ...workflowShellEnv,
    PATH: `${installedGitleaksDir}:${process.env.FAKE_BIN}:${process.env.PATH}`,
};
runWorkflowShell('PR merge-diff secret positive control', prMergePositiveControlRun, {
    ...prWorkflowEnv,
    GITLEAKS_EXPECTED_LEAK_EXIT_CODE: '79',
    FAKE_GITLEAKS_REQUIRE_MERGE_DIFF: 'true',
    FAKE_GITLEAKS_STATUS: '79',
});
const prMergePositiveControlPrefix = `${trustedGitleaksPrefix} --exit-code=79 --log-opts=`;
const prMergePositiveControlCommands = readFileSync(workflowCommandLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('gitleaks git '));
expect(
    prMergePositiveControlCommands.some((command) => {
        if (!command.startsWith(prMergePositiveControlPrefix)) return false;
        const [range, mergeDiffFlag, fixtureGitPath, ...extra] = command.slice(prMergePositiveControlPrefix.length).split(' ');
        return (
            /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/u.test(range ?? '') &&
            mergeDiffFlag === '-m' &&
            fixtureGitPath?.includes('/gitleaks-pr-merge-control.') === true &&
            fixtureGitPath.endsWith('/.git') &&
            extra.length === 0
        );
    }),
    'PR merge-diff positive control must execute with trusted inputs, hardened flags, exit code 79, merge diffs, and its fixture Git database'
);
const prMergePositiveControlClean = runWorkflowShellResult(prMergePositiveControlRun, {
    ...prWorkflowEnv,
    GITLEAKS_EXPECTED_LEAK_EXIT_CODE: '79',
    FAKE_GITLEAKS_REQUIRE_MERGE_DIFF: 'true',
    FAKE_GITLEAKS_STATUS: '0',
});
expect(
    prMergePositiveControlClean.status === 1,
    'PR merge-diff positive control must fail closed when Gitleaks returns clean for its synthetic secret'
);
writeFileSync(workflowCommandLog, '');
runWorkflowShell('PR diff secret scan', prSecretScanRun, {
    ...prWorkflowEnv,
    BASE_SHA: 'base-sha',
    HEAD_SHA: 'head-sha',
    FAKE_GITLEAKS_STATUS: '0',
});
const prDiffGitleaksCommands = readFileSync(workflowCommandLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('gitleaks git '));
expect(
    prDiffGitleaksCommands.includes(
        `${trustedGitleaksPrefix} --exit-code=1 --log-opts=base-sha..head-sha -m ${process.env.TEST_TEMP_ROOT}/scan-target/.git`
    ),
    'PR diff secret scan must execute the trusted scanner only over immutable merge diffs in the base-to-head range'
);
const prScannerFailure = runWorkflowShellResult(prSecretScanRun, {
    ...prWorkflowEnv,
    BASE_SHA: 'base-sha',
    HEAD_SHA: 'head-sha',
    FAKE_GITLEAKS_STATUS: '71',
});
expect(prScannerFailure.status === 71, 'PR diff scanner nonzero status must propagate through the job step');
writeFileSync(workflowCommandLog, '');
const prChecksumFailure = runWorkflowShellResult(prGitleaksInstall?.run ?? '', {
    ...workflowShellEnv,
    GITHUB_PATH: gitleaksPath,
    FAKE_SHA256SUM_STATUS: '44',
});
expect(prChecksumFailure.status === 44, 'PR Gitleaks checksum failure must stop before scanning');
expect(!readFileSync(workflowCommandLog, 'utf8').includes('tar '), 'PR Gitleaks checksum failure must prevent binary extraction and scanning');
expect(!existsSync(maliciousHelperMarker), 'PR-owned target helper must not influence the PR diff secret scan');

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
