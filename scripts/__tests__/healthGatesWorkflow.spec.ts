import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type UnknownRecord = Record<string, unknown>;

const APPROVED_REVIEW_CONDITION =
    "github.event_name != 'pull_request_review' || (github.event.action == 'submitted' && github.event.review.state == 'approved')";
const GATE_CONDITION = 'always()';
const GATE_EVENT_REFERENCE = '${{ github.event_name }}';
const GATE_REVIEW_ACTION_REFERENCE = '${{ github.event.action }}';
const GATE_REVIEW_STATE_REFERENCE = '${{ github.event.review.state }}';
const GATE_REVIEW_COMMIT_REFERENCE = '${{ github.event.review.commit_id }}';
const GATE_HEAD_SHA_REFERENCE = '${{ github.event.pull_request.head.sha }}';
const FAIL_CLOSED_PULL_REQUEST_GUARD = `if [ "$EVENT" = "pull_request" ]; then
  printf 'pull-request pushes cannot satisfy Gate without a current-head approval run\\n'
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
const HEAVY_SUCCESS_FILTER = `["codeql", "secrets"][] as $job
    | select(.[$job].result != "success")
    | "\\($job): \\(.[$job].result // "missing")"`;
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const SECRET_SCAN_CONDITION = "needs.decide.outputs.heavy == 'true'";
const PULL_REQUEST_CONCURRENCY_CANCELLATION =
    "${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_review' }}";
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
    assertGateContract(candidate);
    return stringAt(scope, 'run');
}

function decideAdmits(eventName: string, reviewAction: string, reviewState: string): boolean {
    assertHeavyScanChain(workflow);
    return eventName !== 'pull_request_review' || (reviewAction === 'submitted' && reviewState === 'approved');
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
    reviewAction = 'submitted'
): number | null {
    return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
            ...process.env,
            EVENT: eventName,
            REVIEW_ACTION: reviewAction,
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
    if (stringAt(scan, 'run') !== 'gitleaks git --redact --no-banner --verbose .') {
        throw new Error('secret scan must invoke the event-independent Gitleaks CLI');
    }
    if (scan.env !== undefined) {
        throw new Error('secret scan command must not receive an environment token');
    }
}

describe('health gates workflow contract', () => {
    it('should parse and subscribe only to the intended events', () => {
        expect(workflowDocument.errors).toEqual([]);
        const events = recordAt(workflow, 'on');

        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted', 'dismissed']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(recordAt(workflow, 'permissions')).toEqual({ contents: 'read' });
        expect(recordAt(workflow, 'concurrency')['cancel-in-progress']).toBe(PULL_REQUEST_CONCURRENCY_CANCELLATION);
    });

    it('should fail closed until a current-head approval completes both heavy security jobs', () => {
        const gateScript = stringAt(
            stepNamed(jobAt(workflow, 'gate'), 'Require every job to have succeeded or been skipped'),
            'run'
        );
        const successfulResults = gateResults(workflow, 'success');
        const skippedResults = gateResults(workflow, 'skipped');
        const approvedResults = gateResults(workflow, 'skipped', { codeql: 'success', secrets: 'success' });

        expect({
            approvedWithSkippedCodeql:
                runGateScript(
                    gateScript,
                    'pull_request_review',
                    'approved',
                    gateResults(workflow, 'skipped', { secrets: 'success' })
                ) === 0,
            approvedWithSkippedSecrets:
                runGateScript(
                    gateScript,
                    'pull_request_review',
                    'approved',
                    gateResults(workflow, 'skipped', { codeql: 'success' })
                ) === 0,
            pullRequest: runGateScript(gateScript, 'pull_request', '', successfulResults) === 0,
        }).toEqual({
            approvedWithSkippedCodeql: false,
            approvedWithSkippedSecrets: false,
            pullRequest: false,
        });
        expect(runGateScript(gateScript, 'schedule', '', skippedResults)).toBe(0);
        expect(runGateScript(gateScript, 'workflow_dispatch', '', skippedResults)).toBe(0);
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
        for (const job of ['codeql', 'secrets']) {
            for (const result of ['skipped', 'failure'] as const) {
                expect(
                    runGateScript(
                        gateScript,
                        'pull_request_review',
                        'approved',
                        gateResults(workflow, 'skipped', { codeql: 'success', secrets: 'success', [job]: result })
                    )
                ).not.toBe(0);
            }
        }

        const scopeScript = assertHeavyScanChain(workflow);

        expect(decideAdmits('pull_request_review', 'submitted', 'approved')).toBe(true);
        expect(decideAdmits('pull_request_review', 'submitted', 'commented')).toBe(false);
        expect(decideAdmits('pull_request_review', 'submitted', 'changes_requested')).toBe(false);
        expect(decideAdmits('pull_request_review', 'dismissed', 'approved')).toBe(false);
        expect(decideAdmits('pull_request', '', '')).toBe(true);
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
        expect(runScopeScript(scopeScript, 'workflow_dispatch')).toEqual({
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

    it('should reject the legacy gate shell that admits non-approved reviews', () => {
        const legacyGate = asRecord(structuredClone(workflow), 'legacy gate workflow');
        const legacyStep = stepNamed(jobAt(legacyGate, 'gate'), 'Require every job to have succeeded or been skipped');
        legacyStep.run = stringAt(legacyStep, 'run').replace(`${FAIL_CLOSED_REVIEW_GUARD}\n`, '');

        expect(
            runGateScript(
                stringAt(legacyStep, 'run'),
                'pull_request_review',
                'commented',
                gateResults(legacyGate, 'skipped', { codeql: 'success', secrets: 'success' })
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
