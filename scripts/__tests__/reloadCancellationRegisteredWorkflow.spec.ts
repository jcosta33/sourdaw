import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type Mapping = Record<string, unknown>;

const originalMerge = '94aa5ab19a617fc7a3de83fa7aa8afde8b3361b9';
const originalImage =
    'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const pnpmSetup = 'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86';
const setupNode = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const upload = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const expectedSteps = [
    'Initialize diagnostic evidence',
    'Checkout diagnostic harness',
    'Checkout original source',
    'Set up pinned pnpm',
    'Restore original lockfile cache',
    'Record runtime provenance',
    'Install original dependencies',
    'Verify original preinstalled browser runtime',
    'Run one advisory diagnostic',
    'Upload diagnostic evidence',
];

// Pin the container caller independently of the general workflow snapshot.
const runtimeProvenance = String.raw`set -euo pipefail
{
  node --version
  pnpm --version
  pnpm store path --silent
  node -p "require('./original/package.json').packageManager"
} > "$RUNNER_TEMP/reload-cancellation/runtime.txt"
test "$(node --version)" = v24.19.0
test "$(pnpm --version)" = 11.6.0
test "$(node -p process.platform)" = linux
if ! test -x /usr/bin/timeout; then
  printf 'Required GNU timeout is unavailable\n' >&2
  exit 1
fi
{
  /usr/bin/timeout --version
  dpkg-query -W coreutils
  sha256sum /usr/bin/timeout
} > "$RUNNER_TEMP/reload-cancellation/timeout-provenance.txt"
case "$(head -n 1 "$RUNNER_TEMP/reload-cancellation/timeout-provenance.txt")" in
  'timeout (GNU coreutils) '*) ;;
  *)
    printf 'Required GNU timeout was not identified\n' >&2
    exit 1
    ;;
esac
timeout_control_status=0
/usr/bin/timeout --signal=TERM --kill-after=1s 2s bash -c 'exit 0' || timeout_control_status=$?
printf 'success=%s\n' "$timeout_control_status" > "$RUNNER_TEMP/reload-cancellation/timeout-controls.txt"
test "$timeout_control_status" = 0
timeout_control_status=0
/usr/bin/timeout --signal=TERM --kill-after=1s 2s bash -c 'exit 37' || timeout_control_status=$?
printf 'failure=%s\n' "$timeout_control_status" >> "$RUNNER_TEMP/reload-cancellation/timeout-controls.txt"
test "$timeout_control_status" = 37
timeout_control_status=0
/usr/bin/timeout --signal=TERM --kill-after=1s 1s bash -c 'trap "printf trapped-zero; exit 0" TERM; while :; do sleep 1; done' > "$RUNNER_TEMP/reload-cancellation/timeout-trapped-zero.txt" || timeout_control_status=$?
printf 'deadline=%s\n' "$timeout_control_status" >> "$RUNNER_TEMP/reload-cancellation/timeout-controls.txt"
test "$timeout_control_status" = 124
test "$(cat "$RUNNER_TEMP/reload-cancellation/timeout-trapped-zero.txt")" = trapped-zero
# Inspect the pinned image first; add only strace to this disposable
# container if absent. No upgrades, ptrace privilege or seccomp changes.
if ! test -x /usr/bin/strace; then
  printf 'strace absent from pinned image; installing only strace\n' > "$RUNNER_TEMP/reload-cancellation/strace-install.txt"
  (cd harness && /usr/bin/timeout --signal=TERM --kill-after=15s 3m bash scripts/aptWithoutMicrosoftFeed.sh bash -c 'apt-get update && apt-get install --no-install-recommends --no-upgrade -y strace')
else
  printf 'strace already present in pinned image\n' > "$RUNNER_TEMP/reload-cancellation/strace-install.txt"
fi
{
  /usr/bin/strace --version
  dpkg-query -W strace
  sha256sum /usr/bin/strace
} > "$RUNNER_TEMP/reload-cancellation/strace-provenance.txt"
`;

function mapping(value: unknown, label: string): Mapping {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as Mapping;
}

function stepsOf(value: Mapping): Mapping[] {
    const steps = value.steps;
    if (!Array.isArray(steps)) {
        throw new TypeError('diagnostic steps must be a list');
    }
    return steps.map((step: unknown) => mapping(step, 'diagnostic step'));
}

function diagnosticJob(value: Mapping): Mapping {
    return mapping(mapping(value.jobs, 'jobs').diagnose, 'diagnose');
}

function assertRegisteredDiagnostic(value: Mapping): void {
    assert.deepEqual(Object.keys(value), ['name', 'on', 'permissions', 'jobs']);
    assert.equal(value.name, 'Reload cancellation advisory diagnostic');
    const events = mapping(value.on, 'events');
    assert.deepEqual(Object.keys(events), ['pull_request']);
    assert.deepEqual(mapping(events.pull_request, 'pull_request'), {
        types: ['synchronize'],
        paths: [
            '.github/workflows/reload-cancellation-diagnostic.yml',
            'scripts/diagnostics/reloadCancellation/**',
            'scripts/__tests__/reloadCancellation*.spec.ts',
        ],
    });
    assert.deepEqual(value.permissions, { contents: 'read' });
    assert.equal(value.concurrency, undefined);
    assert.deepEqual(Object.keys(mapping(value.jobs, 'jobs')), ['diagnose']);

    const job = diagnosticJob(value);
    assert.equal(job.name, 'Diagnose original reload cancellation');
    assert.equal(
        job.if,
        "${{ github.event.action == 'synchronize' && github.event.pull_request.number == 5847 && github.event.before == '7500e21497be9f146d928062aca8652c6a80cf3b' && github.run_attempt == 1 }}"
    );
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.deepEqual(job.container, { image: originalImage, options: '--init --ipc=host' });
    assert.deepEqual(job.defaults, { run: { shell: 'bash' } });
    assert.equal(job['timeout-minutes'], 75);
    assert.equal(job.permissions, undefined);
    assert.equal(job.environment, undefined);
    assert.equal(job.strategy, undefined);
    assert.equal(job['continue-on-error'], undefined);

    const steps = stepsOf(job);
    assert.deepEqual(
        steps.map((step) => step.name),
        expectedSteps
    );
    assert.match(String(steps[0]?.run), /mkdir -p "\$RUNNER_TEMP\/reload-cancellation"/);
    assert.equal(steps[1]?.uses, checkout);
    assert.deepEqual(steps[1]?.with, {
        ref: '${{ github.event.pull_request.head.sha }}',
        path: 'harness',
        'persist-credentials': false,
    });
    assert.equal(steps[2]?.uses, checkout);
    assert.deepEqual(steps[2]?.with, { ref: originalMerge, path: 'original', 'persist-credentials': false });
    assert.equal(steps[3]?.uses, pnpmSetup);
    assert.deepEqual(steps[3]?.with, { package_json_file: 'original/package.json' });
    assert.equal(steps[4]?.uses, setupNode);
    assert.deepEqual(steps[4]?.with, {
        'node-version': '24.19.0',
        cache: 'pnpm',
        'cache-dependency-path': 'original/pnpm-lock.yaml',
    });
    assert.equal(steps[5]?.['timeout-minutes'], 4);
    assert.equal(steps[5]?.run, runtimeProvenance);
    assert.equal(steps[6]?.['working-directory'], 'original');
    assert.equal(steps[6]?.run, 'pnpm install --frozen-lockfile');
    assert.equal(steps[7]?.['working-directory'], 'original');
    assert.equal(steps[7]?.run, 'node scripts/verifyPlaywrightRuntime.ts 1.63.0');
    assert.equal(
        steps[8]?.run,
        'set -o pipefail\nnode harness/scripts/diagnostics/reloadCancellation/run.ts "$GITHUB_WORKSPACE/harness" "$GITHUB_WORKSPACE/original" "$RUNNER_TEMP/reload-cancellation" 2>&1 | tee "$RUNNER_TEMP/reload-cancellation/collector.log"\n'
    );
    assert.equal(steps[9]?.if, '${{ always() }}');
    assert.equal(steps[9]?.uses, upload);
    assert.deepEqual(steps[9]?.with, {
        name: 'reload-cancellation-advisory-${{ github.run_id }}',
        path: '${{ runner.temp }}/reload-cancellation/',
        'retention-days': 7,
        'if-no-files-found': 'error',
    });
    for (const step of steps) {
        assert.equal(step['continue-on-error'], undefined);
    }
    assert.doesNotMatch(JSON.stringify(value), /\$\{\{\s*(?:secrets\b|github\.token\b)/);
}

const source = readFileSync(resolve('.github/workflows/reload-cancellation-diagnostic.yml'), 'utf8');
const document = parseDocument(source, { uniqueKeys: true });
const workflow = mapping(document.toJS(), 'diagnostic workflow');

describe('registered reload cancellation advisory workflow', () => {
    it('has valid YAML and pins one read-only original attempt', () => {
        expect(document.errors).toEqual([]);
        expect(() => assertRegisteredDiagnostic(workflow)).not.toThrow();
    });

    const unsafeProvisioning: Array<readonly [string, string, string]> = [
        ['unbounded install', '/usr/bin/timeout --signal=TERM --kill-after=15s 3m ', ''],
        ['unfiltered install', 'bash scripts/aptWithoutMicrosoftFeed.sh bash -c', 'bash -c'],
        ['foreground install', '--kill-after=15s 3m', '--foreground --kill-after=15s 3m'],
        ['preserved timeout status', '--kill-after=15s 3m', '--preserve-status --kill-after=15s 3m'],
        ['missing kill grace', '--kill-after=15s ', ''],
        ['ignored install failure', "-y strace')", "-y strace') || true"],
        ['broadened install', '-y strace', '-y strace curl'],
        ['enabled upgrades', ' --no-upgrade', ''],
        ['enabled recommendations', ' --no-install-recommends', ''],
        [
            'host-only deadline mode',
            'aptWithoutMicrosoftFeed.sh bash -c',
            'aptWithoutMicrosoftFeed.sh --deadline 3m -- bash -c',
        ],
        ['missing Linux qualification', 'test "$(node -p process.platform)" = linux', 'true'],
        ['missing timeout qualification', 'if ! test -x /usr/bin/timeout; then', 'if false; then'],
        ['missing GNU version', '/usr/bin/timeout --version', 'printf fake'],
        ['missing timeout hash', 'sha256sum /usr/bin/timeout', 'true'],
        ['missing strace hash', 'sha256sum /usr/bin/strace', 'true'],
        ['ignored success control', 'test "$timeout_control_status" = 0', 'true'],
        ['ignored failure control', 'test "$timeout_control_status" = 37', 'true'],
        [
            'accepted trapped zero after deadline',
            'test "$timeout_control_status" = 124',
            'test "$timeout_control_status" = 0',
        ],
        [
            'unproved zero-exit trap',
            'test "$(cat "$RUNNER_TEMP/reload-cancellation/timeout-trapped-zero.txt")" = trapped-zero',
            'true',
        ],
        ['nonfatal shell', 'set -euo pipefail', 'set -uo pipefail'],
    ];

    it.each(unsafeProvisioning)('rejects container provisioning with %s', (_label, from, to) => {
        const candidate = structuredClone(workflow);
        const step = stepsOf(diagnosticJob(candidate))[5]!;
        const before = String(step.run);
        step.run = before.replace(from, to);
        expect(step.run).not.toBe(before);
        expect(() => assertRegisteredDiagnostic(candidate)).toThrow();
    });

    const invalidCases: Array<readonly [string, (value: Mapping) => void]> = [
        [
            'later pull-request action',
            (value: Mapping) =>
                (mapping(mapping(value.on, 'events').pull_request, 'pull_request').types as string[]).push('opened'),
        ],
        ['write grant', (value: Mapping) => (mapping(value.permissions, 'permissions').contents = 'write')],
        [
            'missing provenance step deadline',
            (value: Mapping) => {
                delete stepsOf(diagnosticJob(value))[5]!['timeout-minutes'];
            },
        ],
        [
            'broadened provenance step deadline',
            (value: Mapping) => {
                stepsOf(diagnosticJob(value))[5]!['timeout-minutes'] = 5;
            },
        ],
        [
            'original merge drift',
            (value: Mapping) => (mapping(stepsOf(diagnosticJob(value))[2]?.with, 'checkout').ref = '0'.repeat(40)),
        ],
        [
            'image drift',
            (value: Mapping) =>
                (mapping(diagnosticJob(value).container, 'container').image =
                    'mcr.microsoft.com/playwright:v1.63.0-noble'),
        ],
        ['pnpm action drift', (value: Mapping) => (stepsOf(diagnosticJob(value))[3]!.uses = 'pnpm/action-setup@v6')],
        [
            'manifest drift',
            (value: Mapping) =>
                (mapping(stepsOf(diagnosticJob(value))[3]?.with, 'pnpm setup').package_json_file =
                    'harness/package.json'),
        ],
        [
            'Node drift',
            (value: Mapping) => (mapping(stepsOf(diagnosticJob(value))[4]?.with, 'setup-node')['node-version'] = '24'),
        ],
        [
            'credentialed harness checkout',
            (value: Mapping) =>
                (mapping(stepsOf(diagnosticJob(value))[1]?.with, 'checkout')['persist-credentials'] = true),
        ],
        [
            'credentialed target checkout',
            (value: Mapping) =>
                (mapping(stepsOf(diagnosticJob(value))[2]?.with, 'checkout')['persist-credentials'] = true),
        ],
        [
            'no attempt guard',
            (value: Mapping) => (diagnosticJob(value).if = "${{ github.event.action == 'synchronize' }}"),
        ],
        [
            'another preparation parent',
            (value: Mapping) => {
                const job = diagnosticJob(value);
                job.if = String(job.if).replace('7500e21497be9f146d928062aca8652c6a80cf3b', 'a'.repeat(40));
            },
        ],
        [
            'wrong install directory',
            (value: Mapping) => (stepsOf(diagnosticJob(value))[6]!['working-directory'] = 'harness'),
        ],
        ['weakened install', (value: Mapping) => (stepsOf(diagnosticJob(value))[6]!.run = 'pnpm install')],
        ['wrong runtime', (value: Mapping) => (stepsOf(diagnosticJob(value))[7]!.run = 'true')],
        [
            'lost child exit',
            (value: Mapping) =>
                (stepsOf(diagnosticJob(value))[8]!.run = 'node harness/scripts/diagnostics/reloadCancellation/run.ts'),
        ],
        ['conditional upload', (value: Mapping) => (stepsOf(diagnosticJob(value))[9]!.if = '${{ success() }}')],
        [
            'missing upload',
            (value: Mapping) => {
                const job = diagnosticJob(value);
                job.steps = stepsOf(job).slice(0, -1);
            },
        ],
        ['second job', (value: Mapping) => (mapping(value.jobs, 'jobs').Gate = { name: 'Gate', steps: [] })],
        ['secret reference', (value: Mapping) => (diagnosticJob(value).env = { API_KEY: '${{ secrets.API_KEY }}' })],
    ];

    it.each(invalidCases)('rejects %s', (_label, change) => {
        const candidate = structuredClone(workflow);
        change(candidate);
        expect(() => assertRegisteredDiagnostic(candidate)).toThrow();
    });
});
