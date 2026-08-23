import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type UnknownRecord = Record<string, unknown>;

const APPROVED_REVIEW_CONDITION =
    "github.event_name != 'pull_request_review' || (github.event.review.user.login == 'jcosta33-reviewer[bot]' && github.event.action == 'submitted' && github.event.review.state == 'approved')";
const GATE_CONDITION =
    "always() && (github.event_name != 'pull_request_review' || github.event.review.user.login == 'jcosta33-reviewer[bot]')";
const GATE_EVENT_REFERENCE = '${{ github.event_name }}';
const GATE_REVIEW_ACTION_REFERENCE = '${{ github.event.action }}';
const GATE_REVIEW_AUTHOR_REFERENCE = '${{ github.event.review.user.login }}';
const GATE_REVIEW_STATE_REFERENCE = '${{ github.event.review.state }}';
const GATE_REVIEW_COMMIT_REFERENCE = '${{ github.event.review.commit_id }}';
const GATE_HEAD_SHA_REFERENCE = '${{ github.event.pull_request.head.sha }}';
const FAIL_CLOSED_PULL_REQUEST_GUARD = `if [ "$EVENT" = "pull_request" ]; then
  printf 'pull-request pushes cannot satisfy Gate without a current-head approval run\\n'
  exit 1
fi`;
const FAIL_CLOSED_REVIEW_AUTHOR_GUARD = `if [ "$EVENT" = "pull_request_review" ] && [ "$REVIEW_AUTHOR" != "jcosta33-reviewer[bot]" ]; then
  printf 'pull-request review is not from the required reviewer\\n'
  exit 1
fi`;
const FAIL_CLOSED_REVIEW_GUARD = `if [ "$EVENT" = "pull_request_review" ] && { [ "$REVIEW_ACTION" != "submitted" ] || [ "$REVIEW_STATE" != "approved" ]; }; then
  printf 'pull-request review must be a submitted approval\\n'
  exit 1
fi`;
const CURRENT_HEAD_REVIEW_GUARD = `if [ "$EVENT" = "pull_request_review" ] && { [ -z "$REVIEW_COMMIT" ] || [ "$REVIEW_COMMIT" != "$PULL_REQUEST_HEAD" ]; }; then
  printf 'approval is not for the current pull-request head\\n'
  exit 1
fi`;
const HEAVY_SUCCESS_FILTER = `["dependency-review", "codeql", "secrets"][] as $job
    | select(.[$job].result != "success")
    | "\\($job): \\(.[$job].result // "missing")"`;
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const DEPENDENCY_REVIEW_CONDITION =
    "github.event_name == 'pull_request' || (github.event_name == 'pull_request_review' && needs.decide.outputs.heavy == 'true')";
const REVIEW_HEAD_CONDITION = "github.event_name == 'pull_request_review'";
const NON_REVIEW_CONDITION = "github.event_name != 'pull_request_review'";
const REVIEW_HEAD_REPOSITORY = '${{ github.event.pull_request.head.repo.full_name }}';
const REVIEW_HEAD_SHA = '${{ github.event.review.commit_id }}';
const DEPENDENCY_BASE_SHA = '${{ github.event.pull_request.base.sha }}';
const DEPENDENCY_HEAD_SHA =
    "${{ github.event_name == 'pull_request_review' && github.event.review.commit_id || github.event.pull_request.head.sha }}";
const DEPENDENCY_REVIEW_ACTION = 'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const SECRET_SCAN_CONDITION = "needs.decide.outputs.heavy == 'true'";
const TRUSTED_GITLEAKS_BASE_SHA =
    "${{ github.event_name == 'pull_request_review' && github.event.pull_request.base.sha || github.sha }}";
const TRUSTED_GITLEAKS_CONFIG = '$RUNNER_TEMP/gitleaks.toml';
const TRUSTED_GITLEAKS_IGNORE = '$RUNNER_TEMP/gitleaksignore';
const REVIEW_ISOLATED_CONCURRENCY_GROUP =
    "health-gates-${{ github.event.pull_request.number || github.ref }}-${{ github.event_name == 'pull_request_review' && github.event.review.user.login != 'jcosta33-reviewer[bot]' && github.run_id || 'trusted' }}";
const PULL_REQUEST_CONCURRENCY_CANCELLATION =
    "${{ github.event_name == 'pull_request' || (github.event_name == 'pull_request_review' && github.event.review.user.login == 'jcosta33-reviewer[bot]') }}";
const UNTRUSTED_EVENT_INTERPOLATION = /\$\{\{\s*github\.(?:event_name|event\.)/;
const TOKEN_REFERENCE = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./i;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowSource = readFileSync(join(repositoryRoot, '.github/workflows/health-gates.yml'), 'utf8');
const workflowDocument = parseDocument(workflowSource);
if (workflowDocument.errors.length > 0) {
    throw new Error(
        `health-gates.yml is invalid YAML: ${workflowDocument.errors.map((error) => error.message).join('; ')}`
    );
}
const workflow = asRecord(workflowDocument.toJS(), 'workflow');

function asRecord(value: unknown, label: string): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as UnknownRecord;
}

function recordAt(record: UnknownRecord, key: string): UnknownRecord {
    return asRecord(record[key], key);
}

function arrayAt(record: UnknownRecord, key: string): unknown[] {
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new TypeError(`${key} must be an array`);
    }
    return value;
}

function jobAt(candidate: UnknownRecord, name: string): UnknownRecord {
    return recordAt(recordAt(candidate, 'jobs'), name);
}

function stepNamed(owner: UnknownRecord, name: string): UnknownRecord {
    const step = arrayAt(owner, 'steps').find((candidate: unknown) => asRecord(candidate, 'step').name === name);
    if (step === undefined) {
        throw new Error(`missing workflow step: ${name}`);
    }
    return asRecord(step, name);
}

function stringAt(record: UnknownRecord, key: string): string {
    const value = record[key];
    if (typeof value !== 'string') {
        throw new TypeError(`${key} must be a string`);
    }
    return value;
}

function assertDependencyReviewChain(candidate: UnknownRecord): void {
    const dependencyReview = jobAt(candidate, 'dependency-review');
    if (dependencyReview.needs !== 'decide') {
        throw new Error('dependency review must depend directly on decide');
    }
    if (dependencyReview.if !== DEPENDENCY_REVIEW_CONDITION) {
        throw new Error('dependency review must run on pull requests and trusted approval events');
    }

    const reviewCheckout = stepNamed(dependencyReview, 'Checkout reviewed head');
    if (reviewCheckout.if !== REVIEW_HEAD_CONDITION) {
        throw new Error('dependency review must isolate its reviewed-head checkout to review events');
    }
    const reviewCheckoutOptions = recordAt(reviewCheckout, 'with');
    if (reviewCheckoutOptions.repository !== REVIEW_HEAD_REPOSITORY) {
        throw new Error('dependency review must checkout the pull-request head repository');
    }
    if (reviewCheckoutOptions.ref !== REVIEW_HEAD_SHA) {
        throw new Error('dependency review must checkout the exact reviewed commit');
    }
    if (reviewCheckoutOptions['persist-credentials'] !== false) {
        throw new Error('dependency review checkout must not persist credentials');
    }

    const pullRequestCheckout = stepNamed(dependencyReview, 'Checkout');
    if (pullRequestCheckout.if !== NON_REVIEW_CONDITION) {
        throw new Error('ordinary dependency review checkout must stay on pull-request events');
    }
    if (recordAt(pullRequestCheckout, 'with')['persist-credentials'] !== false) {
        throw new Error('ordinary dependency review checkout must not persist credentials');
    }

    const review = stepNamed(dependencyReview, 'Review dependency changes');
    if (review.uses !== DEPENDENCY_REVIEW_ACTION) {
        throw new Error('dependency review action must remain pinned');
    }
    const reviewOptions = recordAt(review, 'with');
    if (reviewOptions['base-ref'] !== DEPENDENCY_BASE_SHA) {
        throw new Error('dependency review must compare from the exact pull-request base sha');
    }
    if (reviewOptions['head-ref'] !== DEPENDENCY_HEAD_SHA) {
        throw new Error('dependency review must compare through the exact event head sha');
    }

    if (!arrayAt(jobAt(candidate, 'gate'), 'needs').includes('dependency-review')) {
        throw new Error('gate must depend on dependency review');
    }
}

function assertHeavyScanChain(candidate: UnknownRecord): string {
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== APPROVED_REVIEW_CONDITION) {
        throw new Error('decide must exclude non-approved pull-request reviews');
    }
    if (recordAt(decide, 'outputs').heavy !== HEAVY_OUTPUT_REFERENCE) {
        throw new Error('decide heavy output must expose steps.scope.outputs.heavy');
    }
    const scope = stepNamed(decide, 'Resolve scope');
    if (scope.id !== 'scope') {
        throw new Error('Resolve scope must retain the scope step id');
    }
    if (jobAt(candidate, 'secrets').if !== SECRET_SCAN_CONDITION) {
        throw new Error('secret scan must consume needs.decide.outputs.heavy');
    }
    if (jobAt(candidate, 'secrets').needs !== 'decide') {
        throw new Error('secret scan job must depend directly on decide');
    }
    const gateNeeds = arrayAt(jobAt(candidate, 'gate'), 'needs');
    if (!gateNeeds.includes('secrets')) {
        throw new Error('gate must depend on the secret scan job');
    }
    assertDependencyReviewChain(candidate);
    assertGateContract(candidate);
    return stringAt(scope, 'run');
}

function decideAdmits(eventName: string, reviewAction: string, reviewState: string, reviewAuthor: string): boolean {
    assertHeavyScanChain(workflow);
    return (
        eventName !== 'pull_request_review' ||
        (reviewAuthor === 'jcosta33-reviewer[bot]' && reviewAction === 'submitted' && reviewState === 'approved')
    );
}

function assertGateContract(candidate: UnknownRecord): string {
    const gate = jobAt(candidate, 'gate');
    if (gate.if !== GATE_CONDITION) {
        throw new Error('gate must use always() to report after terminal dependencies');
    }
    const step = stepNamed(gate, 'Require every job to have succeeded or been skipped');
    const environment = recordAt(step, 'env');
    if (environment.EVENT !== GATE_EVENT_REFERENCE) {
        throw new Error('gate must receive the exact event name');
    }
    if (environment.REVIEW_ACTION !== GATE_REVIEW_ACTION_REFERENCE) {
        throw new Error('gate must receive the exact pull-request review action');
    }
    if (environment.REVIEW_AUTHOR !== GATE_REVIEW_AUTHOR_REFERENCE) {
        throw new Error('gate must receive the exact pull-request review author');
    }
    if (environment.REVIEW_STATE !== GATE_REVIEW_STATE_REFERENCE) {
        throw new Error('gate must receive the exact pull-request review state');
    }
    if (environment.REVIEW_COMMIT !== GATE_REVIEW_COMMIT_REFERENCE) {
        throw new Error('gate must receive the reviewed commit id');
    }
    if (environment.PULL_REQUEST_HEAD !== GATE_HEAD_SHA_REFERENCE) {
        throw new Error('gate must receive the pull-request head sha');
    }
    const script = stringAt(step, 'run');
    if (UNTRUSTED_EVENT_INTERPOLATION.test(script)) {
        throw new Error('gate shell must receive untrusted event data through its environment');
    }
    if (!script.includes(FAIL_CLOSED_PULL_REQUEST_GUARD)) {
        throw new Error('gate shell must fail closed for pull-request pushes');
    }
    if (!script.includes(FAIL_CLOSED_REVIEW_AUTHOR_GUARD)) {
        throw new Error('gate shell must fail closed for reviews from other authors');
    }
    if (!script.includes(FAIL_CLOSED_REVIEW_GUARD)) {
        throw new Error('gate shell must fail closed for non-approved pull-request reviews');
    }
    if (!script.includes(CURRENT_HEAD_REVIEW_GUARD)) {
        throw new Error('gate shell must reject approvals for a stale pull-request head');
    }
    if (!script.includes(HEAVY_SUCCESS_FILTER)) {
        throw new Error('gate shell must require successful CodeQL and secret scan results');
    }
    return script;
}

type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

function gateResults(
    candidate: UnknownRecord,
    result: JobResult,
    overrides: Readonly<Record<string, JobResult>> = {}
): string {
    return JSON.stringify(
        Object.fromEntries(
            arrayAt(jobAt(candidate, 'gate'), 'needs').map((name) => {
                const jobName = String(name);
                return [jobName, { result: overrides[jobName] ?? result }];
            })
        )
    );
}

function runGateScript(
    script: string,
    eventName: string,
    reviewState: string,
    results: string,
    reviewCommit = 'head-sha',
    pullRequestHead = 'head-sha',
    reviewAction = 'submitted',
    reviewAuthor = 'jcosta33-reviewer[bot]'
): number | null {
    return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
            ...process.env,
            EVENT: eventName,
            REVIEW_ACTION: reviewAction,
            REVIEW_AUTHOR: reviewAuthor,
            REVIEW_STATE: reviewState,
            REVIEW_COMMIT: reviewCommit,
            PULL_REQUEST_HEAD: pullRequestHead,
            RESULTS: results,
        },
        shell: false,
    }).status;
}

function runScopeScript(script: string, eventName: string): UnknownRecord {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-health-scope-'));
    const outputPath = join(directory, 'github-output');
    try {
        const result = spawnSync('bash', ['-c', script], {
            encoding: 'utf8',
            env: {
                ...process.env,
                EVENT: eventName,
                RUST: 'false',
                SERVER: 'false',
                E2E: 'false',
                WEB: 'false',
                GITHUB_OUTPUT: outputPath,
            },
            shell: false,
        });
        if (result.status !== 0) {
            throw new Error(`Resolve scope failed for ${eventName}: ${result.stderr}`);
        }
        return Object.fromEntries(
            readFileSync(outputPath, 'utf8')
                .trim()
                .split('\n')
                .map((line) => {
                    const separator = line.indexOf('=');
                    return [line.slice(0, separator), line.slice(separator + 1)];
                })
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function assertCredentiallessScanner(candidate: UnknownRecord): void {
    const secrets = jobAt(candidate, 'secrets');
    if (TOKEN_REFERENCE.test(JSON.stringify(secrets))) {
        throw new Error('secret scan job must not reference GitHub tokens or repository secrets');
    }
    if (secrets.permissions !== undefined) {
        throw new Error('secret scan job must inherit the workflow read-only permission');
    }

    const checkout = stepNamed(secrets, 'Checkout');
    const checkoutOptions = recordAt(checkout, 'with');
    if (checkoutOptions['fetch-depth'] !== 0) {
        throw new Error('secret scan checkout must fetch the full history');
    }
    if (checkoutOptions['persist-credentials'] !== false) {
        throw new Error('secret scan checkout must not persist credentials');
    }

    const install = stepNamed(secrets, 'Install Gitleaks');
    const scan = stepNamed(secrets, 'Scan history for secrets');
    if (install.uses !== undefined || scan.uses !== undefined) {
        throw new Error('Gitleaks install and scan must not invoke event-aware actions');
    }
    const installEnvironment = recordAt(install, 'env');
    if (installEnvironment.GITLEAKS_VERSION !== '8.30.1') {
        throw new Error('Gitleaks release must remain pinned');
    }
    if (
        installEnvironment.GITLEAKS_LINUX_X64_SHA256 !==
        '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
    ) {
        throw new Error('Gitleaks archive digest must remain pinned');
    }
    const installCommand = stringAt(install, 'run');
    if (
        !installCommand.includes(
            `printf '%s  %s\\n' "$GITLEAKS_LINUX_X64_SHA256" "$archive" | sha256sum --check --strict -`
        )
    ) {
        throw new Error('Gitleaks checksum command must verify the archive with the pinned digest variable');
    }
    if (
        !installCommand.includes(
            'https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz'
        )
    ) {
        throw new Error('Gitleaks download must use the pinned release variable');
    }
    if (/github\.event|GITHUB_EVENT/i.test(installCommand)) {
        throw new Error('Gitleaks installation must be event-independent');
    }

    const policy = stepNamed(secrets, 'Load trusted Gitleaks policy');
    const policyEnvironment = recordAt(policy, 'env');
    if (policyEnvironment.TRUSTED_BASE_SHA !== TRUSTED_GITLEAKS_BASE_SHA) {
        throw new Error('Gitleaks policy must come from the trusted base sha');
    }
    const policyCommand = stringAt(policy, 'run');
    if (UNTRUSTED_EVENT_INTERPOLATION.test(policyCommand)) {
        throw new Error('Gitleaks policy shell must receive event data through its environment');
    }
    if (!policyCommand.includes(`trusted_config="${TRUSTED_GITLEAKS_CONFIG}"`)) {
        throw new Error('trusted Gitleaks config must be written outside the checked-out repository');
    }
    if (!policyCommand.includes(`trusted_ignore="${TRUSTED_GITLEAKS_IGNORE}"`)) {
        throw new Error('trusted Gitleaks ignore file must be written outside the checked-out repository');
    }
    if (!policyCommand.includes('git show "${TRUSTED_BASE_SHA}:.gitleaks.toml" > "$trusted_config"')) {
        throw new Error('Gitleaks config must be loaded from the trusted base commit');
    }
    if (!policyCommand.includes('git show "${TRUSTED_BASE_SHA}:.gitleaksignore" > "$trusted_ignore"')) {
        throw new Error('Gitleaks ignore file must be loaded from the trusted base commit when present');
    }

    const scanCommand = stringAt(scan, 'run');
    for (const requiredArgument of [
        `--config "${TRUSTED_GITLEAKS_CONFIG}"`,
        `--gitleaks-ignore-path "${TRUSTED_GITLEAKS_IGNORE}"`,
        '--ignore-gitleaks-allow',
        '--redact',
        '--no-banner',
        '--verbose',
    ]) {
        if (!scanCommand.includes(requiredArgument)) {
            throw new Error(`secret scan must include ${requiredArgument}`);
        }
    }
    if (scan.env !== undefined) {
        throw new Error('secret scan command must not receive an environment token');
    }
}

function runGit(repository: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        env: process.env,
    }).trim();
}

function runSecretSuppressionFixture(
    candidate: UnknownRecord,
    transformScan: (script: string) => string
): number | null {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-gitleaks-policy-'));
    const runnerTemp = join(fixtureRoot, 'runner-temp');
    const repository = join(fixtureRoot, 'repository');
    const bin = join(fixtureRoot, 'bin');
    const fixtureSecret = ['glpat', '0123456789abcdefghij'].join('-');
    mkdirSync(runnerTemp);
    mkdirSync(repository);
    mkdirSync(bin);

    try {
        runGit(repository, ['init', '-b', 'main']);
        runGit(repository, ['config', 'user.name', 'Fixture']);
        runGit(repository, ['config', 'user.email', 'fixture@example.com']);
        writeFileSync(join(repository, '.gitleaks.toml'), 'title = "trusted-policy"\n\n[extend]\nuseDefault = true\n');
        runGit(repository, ['add', '.gitleaks.toml']);
        runGit(repository, ['commit', '--no-gpg-sign', '-m', 'test: trusted base policy']);
        const trustedBase = runGit(repository, ['rev-parse', 'HEAD']);

        writeFileSync(
            join(repository, '.gitleaks.toml'),
            'title = "PR-controlled empty rule set"\n\n[[rules]]\nid = "never-match"\ndescription = "never"\nregex = "this-pattern-cannot-match-fixture"\n'
        );
        writeFileSync(join(repository, 'fixture.txt'), `${fixtureSecret} # gitleaks:allow\n`);
        runGit(repository, ['add', '.gitleaks.toml', 'fixture.txt']);
        runGit(repository, ['commit', '--no-gpg-sign', '-m', 'test: add suppressed fixture']);
        const fixtureCommit = runGit(repository, ['rev-parse', 'HEAD']);
        const fixtureFingerprint = `${fixtureCommit}:fixture.txt:gitlab-pat:1`;
        writeFileSync(join(repository, '.gitleaksignore'), `${fixtureFingerprint}\n`);
        runGit(repository, ['add', '.gitleaksignore']);
        runGit(repository, ['commit', '--no-gpg-sign', '-m', 'test: add PR-controlled ignore']);

        const policy = stepNamed(jobAt(candidate, 'secrets'), 'Load trusted Gitleaks policy');
        const policyResult = spawnSync('bash', ['-c', stringAt(policy, 'run')], {
            cwd: repository,
            encoding: 'utf8',
            env: {
                ...process.env,
                RUNNER_TEMP: runnerTemp,
                TRUSTED_BASE_SHA: trustedBase,
            },
            shell: false,
        });
        if (policyResult.status !== 0) {
            throw new Error(`trusted Gitleaks policy fixture failed: ${policyResult.stderr}`);
        }

        const mockGitleaks = join(bin, 'gitleaks');
        writeFileSync(
            mockGitleaks,
            `#!/bin/sh
set -eu
[ "$1" = "git" ] || exit 64
shift
config=
ignore=
ignore_allow=false
target=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) config=$2; shift ;;
    --gitleaks-ignore-path) ignore=$2; shift ;;
    --ignore-gitleaks-allow) ignore_allow=true ;;
    --redact|--no-banner|--verbose) ;;
    .) target=. ;;
    *) exit 64 ;;
  esac
  shift
done
[ "$target" = "." ] || exit 64
if [ -z "$config" ] && grep -q 'PR-controlled empty rule set' .gitleaks.toml; then exit 0; fi
if [ -z "$ignore" ] && grep -Fq "$FIXTURE_FINGERPRINT" .gitleaksignore; then exit 0; fi
if [ "$ignore_allow" != "true" ] && grep -F "$FIXTURE_SECRET" fixture.txt | grep -q 'gitleaks:allow'; then exit 0; fi
[ "$config" = "$RUNNER_TEMP/gitleaks.toml" ] || exit 65
[ "$ignore" = "$RUNNER_TEMP/gitleaksignore" ] || exit 65
grep -q 'trusted-policy' "$config" || exit 65
if grep -Fq "$FIXTURE_FINGERPRINT" "$ignore"; then exit 0; fi
grep -Fq "$FIXTURE_SECRET" fixture.txt && exit 1
exit 0
`
        );
        chmodSync(mockGitleaks, 0o755);

        const scan = stepNamed(jobAt(candidate, 'secrets'), 'Scan history for secrets');
        return spawnSync('bash', ['-c', transformScan(stringAt(scan, 'run'))], {
            cwd: repository,
            encoding: 'utf8',
            env: {
                ...process.env,
                FIXTURE_FINGERPRINT: fixtureFingerprint,
                FIXTURE_SECRET: fixtureSecret,
                PATH: `${bin}:${process.env.PATH ?? ''}`,
                RUNNER_TEMP: runnerTemp,
            },
            shell: false,
        }).status;
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
}

describe('health gates workflow contract', () => {
    it('should parse and subscribe only to the intended events', () => {
        expect(workflowDocument.errors).toEqual([]);
        const events = recordAt(workflow, 'on');

        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted', 'dismissed']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(false);
        expect(recordAt(workflow, 'permissions')).toEqual({ contents: 'read' });
        const concurrency = recordAt(workflow, 'concurrency');
        expect(concurrency.group).toBe(REVIEW_ISOLATED_CONCURRENCY_GROUP);
        expect(concurrency['cancel-in-progress']).toBe(PULL_REQUEST_CONCURRENCY_CANCELLATION);
    });

    it('should fail closed until a current-head approval completes every security job', () => {
        const gateScript = stringAt(
            stepNamed(jobAt(workflow, 'gate'), 'Require every job to have succeeded or been skipped'),
            'run'
        );
        const successfulResults = gateResults(workflow, 'success');
        const skippedResults = gateResults(workflow, 'skipped');
        const approvedResults = gateResults(workflow, 'skipped', {
            'dependency-review': 'success',
            codeql: 'success',
            secrets: 'success',
        });

        expect({
            approvedWithSkippedCodeql:
                runGateScript(
                    gateScript,
                    'pull_request_review',
                    'approved',
                    gateResults(workflow, 'skipped', { 'dependency-review': 'success', secrets: 'success' })
                ) === 0,
            approvedWithSkippedSecrets:
                runGateScript(
                    gateScript,
                    'pull_request_review',
                    'approved',
                    gateResults(workflow, 'skipped', { 'dependency-review': 'success', codeql: 'success' })
                ) === 0,
            pullRequest: runGateScript(gateScript, 'pull_request', '', successfulResults) === 0,
        }).toEqual({
            approvedWithSkippedCodeql: false,
            approvedWithSkippedSecrets: false,
            pullRequest: false,
        });
        expect(runGateScript(gateScript, 'schedule', '', skippedResults)).toBe(0);
        expect(runGateScript(gateScript, 'pull_request_review', 'approved', approvedResults)).toBe(0);
        expect(
            runGateScript(gateScript, 'pull_request_review', 'approved', approvedResults, 'reviewed-sha', 'head-sha')
        ).not.toBe(0);
        expect(runGateScript(gateScript, 'pull_request_review', 'commented', skippedResults)).not.toBe(0);
        expect(runGateScript(gateScript, 'pull_request_review', 'changes_requested', skippedResults)).not.toBe(0);
        expect(
            runGateScript(
                gateScript,
                'pull_request_review',
                'approved',
                approvedResults,
                'head-sha',
                'head-sha',
                'dismissed'
            )
        ).not.toBe(0);
        expect(runGateScript(gateScript, 'pull_request', '', gateResults(workflow, 'failure'))).not.toBe(0);
        for (const job of ['dependency-review', 'codeql', 'secrets']) {
            for (const result of ['skipped', 'failure'] as const) {
                expect(
                    runGateScript(
                        gateScript,
                        'pull_request_review',
                        'approved',
                        gateResults(workflow, 'skipped', {
                            'dependency-review': 'success',
                            codeql: 'success',
                            secrets: 'success',
                            [job]: result,
                        })
                    )
                ).not.toBe(0);
            }
        }

        const scopeScript = assertHeavyScanChain(workflow);

        expect(decideAdmits('pull_request_review', 'submitted', 'approved', 'jcosta33-reviewer[bot]')).toBe(true);
        expect(decideAdmits('pull_request_review', 'submitted', 'approved', 'untrusted-reviewer')).toBe(false);
        expect(decideAdmits('pull_request_review', 'submitted', 'commented', 'jcosta33-reviewer[bot]')).toBe(false);
        expect(decideAdmits('pull_request_review', 'submitted', 'changes_requested', 'jcosta33-reviewer[bot]')).toBe(
            false
        );
        expect(decideAdmits('pull_request_review', 'dismissed', 'approved', 'jcosta33-reviewer[bot]')).toBe(false);
        expect(decideAdmits('pull_request', '', '', '')).toBe(true);
        expect(runScopeScript(scopeScript, 'pull_request_review')).toEqual({
            heavy: 'true',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
        });
        expect(runScopeScript(scopeScript, 'schedule')).toEqual({
            heavy: 'true',
            rust: 'true',
            server: 'true',
            e2e: 'true',
            web: 'true',
        });
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
        });

        const gate = jobAt(workflow, 'gate');
        expect(gate.if).toBe(GATE_CONDITION);
        expect(assertGateContract(workflow)).toContain('.value.result != "success" and .value.result != "skipped"');
    });

    it('should run a checksum-bound event-independent scanner without credentials or secrets', () => {
        expect(() => assertCredentiallessScanner(workflow)).not.toThrow();
    });

    it('should reject PR-controlled config, ignore, and inline suppressions for the fixture secret', () => {
        expect(runSecretSuppressionFixture(workflow, (script) => script)).not.toBe(0);

        const suppressions = [
            '--config "$RUNNER_TEMP/gitleaks.toml" \\\n',
            '--gitleaks-ignore-path "$RUNNER_TEMP/gitleaksignore" \\\n',
            '--ignore-gitleaks-allow \\\n',
        ];
        for (const suppression of suppressions) {
            expect(runSecretSuppressionFixture(workflow, (script) => script.replace(suppression, ''))).toBe(0);
        }
    });

    it('should reject disconnected scope output and the old token-bearing Gitleaks action', () => {
        const disconnected = asRecord(structuredClone(workflow), 'disconnected workflow');
        recordAt(jobAt(disconnected, 'decide'), 'outputs').heavy = '${{ steps.other.outputs.heavy }}';
        expect(() => assertHeavyScanChain(disconnected)).toThrow(
            'decide heavy output must expose steps.scope.outputs.heavy'
        );

        const legacy = asRecord(structuredClone(workflow), 'legacy workflow');
        const legacySecrets = jobAt(legacy, 'secrets');
        const legacySteps = arrayAt(legacySecrets, 'steps');
        const installIndex = legacySteps.findIndex(
            (candidate: unknown) => asRecord(candidate, 'step').name === 'Install Gitleaks'
        );
        legacySteps.splice(installIndex, 1);
        const legacyScan = stepNamed(legacySecrets, 'Scan history for secrets');
        delete legacyScan.run;
        legacyScan.uses = 'gitleaks/gitleaks-action@old';
        legacyScan.env = { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(legacy)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });

    it('should reject disconnected or retargeted secret dependency edges', () => {
        const missingSecretNeeds = asRecord(structuredClone(workflow), 'missing secret dependency workflow');
        delete jobAt(missingSecretNeeds, 'secrets').needs;
        expect(() => assertHeavyScanChain(missingSecretNeeds)).toThrow(
            'secret scan job must depend directly on decide'
        );

        const retargetedSecretNeeds = asRecord(structuredClone(workflow), 'retargeted secret dependency workflow');
        jobAt(retargetedSecretNeeds, 'secrets').needs = 'build';
        expect(() => assertHeavyScanChain(retargetedSecretNeeds)).toThrow(
            'secret scan job must depend directly on decide'
        );

        const missingGateNeeds = asRecord(structuredClone(workflow), 'missing gate dependency workflow');
        arrayAt(jobAt(missingGateNeeds, 'gate'), 'needs').splice(
            arrayAt(jobAt(missingGateNeeds, 'gate'), 'needs').indexOf('secrets'),
            1
        );
        expect(() => assertHeavyScanChain(missingGateNeeds)).toThrow('gate must depend on the secret scan job');

        const retargetedGateNeeds = asRecord(structuredClone(workflow), 'retargeted gate dependency workflow');
        const retargetedGateNeedsList = arrayAt(jobAt(retargetedGateNeeds, 'gate'), 'needs');
        retargetedGateNeedsList[retargetedGateNeedsList.indexOf('secrets')] = 'build';
        expect(() => assertHeavyScanChain(retargetedGateNeeds)).toThrow('gate must depend on the secret scan job');
    });

    it('should reject a push-only or revision-unbound dependency review', () => {
        const pushOnly = asRecord(structuredClone(workflow), 'push-only dependency review workflow');
        jobAt(pushOnly, 'dependency-review').if = "github.event_name == 'pull_request'";
        expect(() => assertDependencyReviewChain(pushOnly)).toThrow(
            'dependency review must run on pull requests and trusted approval events'
        );

        const staleCheckout = asRecord(structuredClone(workflow), 'stale dependency review checkout workflow');
        recordAt(stepNamed(jobAt(staleCheckout, 'dependency-review'), 'Checkout reviewed head'), 'with').ref =
            '${{ github.event.pull_request.head.sha }}';
        expect(() => assertDependencyReviewChain(staleCheckout)).toThrow(
            'dependency review must checkout the exact reviewed commit'
        );

        const unboundComparison = asRecord(structuredClone(workflow), 'unbound dependency comparison workflow');
        delete recordAt(stepNamed(jobAt(unboundComparison, 'dependency-review'), 'Review dependency changes'), 'with')[
            'head-ref'
        ];
        expect(() => assertDependencyReviewChain(unboundComparison)).toThrow(
            'dependency review must compare through the exact event head sha'
        );
    });

    it('should reject the legacy gate shell that admits non-approved reviews', () => {
        const legacyGate = asRecord(structuredClone(workflow), 'legacy gate workflow');
        const legacyStep = stepNamed(jobAt(legacyGate, 'gate'), 'Require every job to have succeeded or been skipped');
        legacyStep.run = stringAt(legacyStep, 'run').replace(`${FAIL_CLOSED_REVIEW_GUARD}\n`, '');

        expect(
            runGateScript(
                stringAt(legacyStep, 'run'),
                'pull_request_review',
                'commented',
                gateResults(legacyGate, 'skipped', {
                    'dependency-review': 'success',
                    codeql: 'success',
                    secrets: 'success',
                })
            )
        ).toBe(0);
        expect(() => assertGateContract(legacyGate)).toThrow(
            'gate shell must fail closed for non-approved pull-request reviews'
        );
    });

    it('should reject a gate shell that lets a push reuse an earlier approval', () => {
        const legacyGate = asRecord(structuredClone(workflow), 'push-admitting gate workflow');
        const legacyStep = stepNamed(jobAt(legacyGate, 'gate'), 'Require every job to have succeeded or been skipped');
        legacyStep.run = stringAt(legacyStep, 'run').replace(`${FAIL_CLOSED_PULL_REQUEST_GUARD}\n`, '');

        expect(runGateScript(stringAt(legacyStep, 'run'), 'pull_request', '', gateResults(legacyGate, 'success'))).toBe(
            0
        );
        expect(() => assertGateContract(legacyGate)).toThrow('gate shell must fail closed for pull-request pushes');
    });

    it('should reject a gate shell that accepts skipped heavy security jobs after approval', () => {
        const weakenedGate = asRecord(structuredClone(workflow), 'heavy-scan-skipping gate workflow');
        const weakenedStep = stepNamed(
            jobAt(weakenedGate, 'gate'),
            'Require every job to have succeeded or been skipped'
        );
        weakenedStep.run = stringAt(weakenedStep, 'run').replace('.[$job].result != "success"', 'false');

        expect(
            runGateScript(
                stringAt(weakenedStep, 'run'),
                'pull_request_review',
                'approved',
                gateResults(weakenedGate, 'skipped')
            )
        ).toBe(0);
        expect(() => assertGateContract(weakenedGate)).toThrow(
            'gate shell must require successful CodeQL and secret scan results'
        );
    });
});
