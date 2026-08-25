import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type UnknownRecord = Record<string, unknown>;
type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

const REVIEW_CONDITION = "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'";
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const HEAVY_CONDITION = "needs.decide.outputs.heavy == 'true'";
const FORCED_SCOPE_OUTPUTS = {
    heavy: 'true',
    rust: 'true',
    server: 'true',
    e2e: 'true',
    web: 'true',
};
const SCOPE_OUTPUT_REFERENCES = {
    heavy: '${{ steps.scope.outputs.heavy }}',
    rust: '${{ steps.scope.outputs.rust }}',
    server: '${{ steps.scope.outputs.server }}',
    e2e: '${{ steps.scope.outputs.e2e }}',
    web: '${{ steps.scope.outputs.web }}',
};
const PULL_REQUEST_CONCURRENCY_GROUP = 'health-gates-${{ github.event.pull_request.number || github.ref }}';
const PULL_REQUEST_CONCURRENCY_CANCELLATION = "${{ github.event_name == 'pull_request' }}";
const DEPENDENCY_REVIEW_ACTION = 'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const TRUSTED_SCANNER_REF = '${{ github.event.pull_request.base.sha || github.sha }}';
const SCAN_TARGET_REF = '${{ github.event.pull_request.head.sha || github.sha }}';
const TOKEN_REFERENCE = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./i;
const CURRENT_NON_GATING_JOBS = ['unit', 'e2e'] as const;
const CURRENT_NON_GATING_JOB_WIRING = {
    unit: { needs: 'decide', if: "needs.decide.outputs.web == 'true'" },
    e2e: { needs: 'decide', if: "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'" },
} satisfies Record<(typeof CURRENT_NON_GATING_JOBS)[number], Readonly<{ needs: string; if: string }>>;

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

function stringAt(record: UnknownRecord, key: string): string {
    const value = record[key];
    if (typeof value !== 'string') {
        throw new TypeError(`${key} must be a string`);
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

function assertConcurrencyContract(candidate: UnknownRecord): void {
    const concurrency = recordAt(candidate, 'concurrency');
    if (concurrency.group !== PULL_REQUEST_CONCURRENCY_GROUP) {
        throw new Error('workflow must group runs by pull request or ref');
    }
    if (concurrency['cancel-in-progress'] !== PULL_REQUEST_CONCURRENCY_CANCELLATION) {
        throw new Error('only a newer pull-request run may cancel in-progress work');
    }
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

function assertScopeContract(candidate: UnknownRecord): string {
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== REVIEW_CONDITION) {
        throw new Error('decide must only admit submitted approved reviews');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(SCOPE_OUTPUT_REFERENCES)) {
        if (outputs[name] !== reference) {
            throw new Error(`decide ${name} output must expose steps.scope.outputs.${name}`);
        }
    }
    const scope = stepNamed(decide, 'Resolve scope');
    if (scope.id !== 'scope') {
        throw new Error('Resolve scope must retain the scope step id');
    }
    return stringAt(scope, 'run');
}

function assertJobGraph(candidate: UnknownRecord): void {
    const dependencyReview = jobAt(candidate, 'dependency-review');
    if (dependencyReview.needs !== 'decide' || dependencyReview.if !== "github.event_name == 'pull_request'") {
        throw new Error('dependency review must remain a pull-request fast-lane job');
    }
    if (stepNamed(dependencyReview, 'Review dependency changes').uses !== DEPENDENCY_REVIEW_ACTION) {
        throw new Error('dependency review action must remain pinned');
    }
    if (jobAt(candidate, 'codeql').if !== HEAVY_CONDITION || jobAt(candidate, 'secrets').if !== HEAVY_CONDITION) {
        throw new Error('security scans must consume the heavy scope output');
    }
    if (jobAt(candidate, 'codeql').needs !== 'decide' || jobAt(candidate, 'secrets').needs !== 'decide') {
        throw new Error('security scans must depend directly on decide');
    }
    const gateNeeds = arrayAt(jobAt(candidate, 'gate'), 'needs');
    for (const job of [
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
    ]) {
        if (!gateNeeds.includes(job)) {
            throw new Error(`gate must depend on ${job}`);
        }
    }
    for (const job of CURRENT_NON_GATING_JOBS) {
        const nonGatingJob = jobAt(candidate, job);
        const expectedWiring = CURRENT_NON_GATING_JOB_WIRING[job];
        if (nonGatingJob.needs !== expectedWiring.needs || nonGatingJob.if !== expectedWiring.if) {
            throw new Error(`${job} must retain its current decide dependency and scope condition`);
        }
        if (gateNeeds.includes(job)) {
            throw new Error(`${job} is currently non-gating`);
        }
    }
}

function assertUnitProvenanceHistory(candidate: UnknownRecord): void {
    const unitCheckout = stepNamed(jobAt(candidate, 'unit'), 'Checkout');
    if (recordAt(unitCheckout, 'with')['fetch-depth'] !== 0) {
        throw new Error('unit must retain complete history for immutable measurement provenance');
    }
    for (const jobName of ['lint', 'boundaries']) {
        const checkout = stepNamed(jobAt(candidate, jobName), 'Checkout');
        const checkoutOptions = checkout.with;
        if (
            checkoutOptions !== undefined &&
            asRecord(checkoutOptions, `${jobName} checkout options`)['fetch-depth'] === 0
        ) {
            throw new Error(`${jobName} must not fetch complete history`);
        }
    }
}

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

function assertGateContract(candidate: UnknownRecord): string {
    const gate = jobAt(candidate, 'gate');
    if (gate.name !== 'Gate' || gate.if !== 'always()') {
        throw new Error('the Gate job must always report under its stable name');
    }
    const step = stepNamed(gate, 'Require every job to have succeeded or been skipped');
    if (recordAt(step, 'env').RESULTS !== '${{ toJSON(needs) }}') {
        throw new Error('gate must receive all dependency results through its environment');
    }
    const script = stringAt(step, 'run');
    if (!script.includes('.value.result != "success" and .value.result != "skipped"')) {
        throw new Error('gate must reject every result other than success or skipped');
    }
    return script;
}

function runGateScript(script: string, results: string): number | null {
    return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, RESULTS: results },
        shell: false,
    }).status;
}

function assertCredentiallessScanner(candidate: UnknownRecord): void {
    const secrets = jobAt(candidate, 'secrets');
    if (TOKEN_REFERENCE.test(JSON.stringify(secrets))) {
        throw new Error('secret scan job must not reference GitHub tokens or repository secrets');
    }
    const trustedScanner = recordAt(stepNamed(secrets, 'Checkout trusted scanner'), 'with');
    if (
        trustedScanner.ref !== TRUSTED_SCANNER_REF ||
        trustedScanner.path !== 'trusted-scanner' ||
        trustedScanner['persist-credentials'] !== false
    ) {
        throw new Error('secret scanner must come from the trusted base and retain no credentials');
    }
    const scanTarget = recordAt(stepNamed(secrets, 'Checkout scan target'), 'with');
    if (
        scanTarget.ref !== SCAN_TARGET_REF ||
        scanTarget.path !== 'scan-target' ||
        scanTarget['fetch-depth'] !== 0 ||
        scanTarget['persist-credentials'] !== false
    ) {
        throw new Error('secret scan target must retain the complete untrusted history without credentials');
    }
    const positiveControl = stepNamed(secrets, 'Validate secret scanner positive control');
    if (recordAt(positiveControl, 'env').GITLEAKS_EXPECTED_LEAK_EXIT_CODE !== 79) {
        throw new Error('secret scanner positive control must require Gitleaks leak exit code 79');
    }
    const trustedScript = 'sh "$GITHUB_WORKSPACE/trusted-scanner/scripts/run-gitleaks-history-scan.sh"';
    if (!stringAt(positiveControl, 'run').includes(trustedScript)) {
        throw new Error('positive control must execute the trusted scanner script');
    }
    const scan = stepNamed(secrets, 'Scan history for secrets');
    if (stringAt(scan, 'run') !== `${trustedScript} "$GITHUB_WORKSPACE/scan-target/.git"`) {
        throw new Error('secret scan must execute the trusted scanner against the scan target history');
    }
}

describe('health gates workflow contract', () => {
    it('parses and subscribes only to the intended events', () => {
        expect(workflowDocument.errors).toEqual([]);
        const events = recordAt(workflow, 'on');
        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(recordAt(workflow, 'permissions')).toEqual({ contents: 'read' });
        expect(() => assertConcurrencyContract(workflow)).not.toThrow();
    });

    it('rejects review-triggered cancellation and changing the pull-request grouping key', () => {
        const cancellingReview = asRecord(structuredClone(workflow), 'cancelling review workflow');
        recordAt(cancellingReview, 'concurrency')['cancel-in-progress'] = "${{ github.event_name != 'schedule' }}";
        expect(() => assertConcurrencyContract(cancellingReview)).toThrow(
            'only a newer pull-request run may cancel in-progress work'
        );
        const splitPullRequest = asRecord(structuredClone(workflow), 'split pull-request workflow');
        recordAt(splitPullRequest, 'concurrency').group = 'health-gates-${{ github.run_id }}';
        expect(() => assertConcurrencyContract(splitPullRequest)).toThrow(
            'workflow must group runs by pull request or ref'
        );
    });

    it('runs the heavy security lane only for approved reviews, schedules, and dispatches', () => {
        const scopeScript = assertScopeContract(workflow);
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
        });
        expect(runScopeScript(scopeScript, 'pull_request_review')).toMatchObject({ heavy: 'true' });
        for (const eventName of ['schedule', 'workflow_dispatch']) {
            expect(runScopeScript(scopeScript, eventName)).toEqual(FORCED_SCOPE_OUTPUTS);
        }
        const nonApproval = asRecord(structuredClone(workflow), 'non-approval workflow');
        jobAt(nonApproval, 'decide').if = "github.event_name != 'pull_request_review'";
        expect(() => assertScopeContract(nonApproval)).toThrow('decide must only admit submitted approved reviews');
        const undisclosedWebScope = asRecord(structuredClone(workflow), 'undisclosed web scope workflow');
        recordAt(jobAt(undisclosedWebScope, 'decide'), 'outputs').web = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(undisclosedWebScope)).toThrow(
            'decide web output must expose steps.scope.outputs.web'
        );
    });

    it('keeps the current fast, heavy, and non-gating job list', () => {
        expect(() => assertJobGraph(workflow)).not.toThrow();
        const disconnected = asRecord(structuredClone(workflow), 'disconnected security workflow');
        jobAt(disconnected, 'secrets').needs = 'build';
        expect(() => assertJobGraph(disconnected)).toThrow('security scans must depend directly on decide');
        const disconnectedUnit = asRecord(structuredClone(workflow), 'disconnected unit workflow');
        jobAt(disconnectedUnit, 'unit').needs = 'static';
        expect(() => assertJobGraph(disconnectedUnit)).toThrow(
            'unit must retain its current decide dependency and scope condition'
        );
        const ungatedE2eScope = asRecord(structuredClone(workflow), 'ungated e2e scope workflow');
        jobAt(ungatedE2eScope, 'e2e').if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertJobGraph(ungatedE2eScope)).toThrow(
            'e2e must retain its current decide dependency and scope condition'
        );
        const prematureUnitGate = asRecord(structuredClone(workflow), 'premature unit gate workflow');
        arrayAt(jobAt(prematureUnitGate, 'gate'), 'needs').push('unit');
        expect(() => assertJobGraph(prematureUnitGate)).toThrow('unit is currently non-gating');
        const prematureE2eGate = asRecord(structuredClone(workflow), 'premature e2e gate workflow');
        arrayAt(jobAt(prematureE2eGate, 'gate'), 'needs').push('e2e');
        expect(() => assertJobGraph(prematureE2eGate)).toThrow('e2e is currently non-gating');
    });

    it('fetches immutable measurement provenance history only in the unit matrix', () => {
        expect(() => assertUnitProvenanceHistory(workflow)).not.toThrow();

        const shallowUnit = asRecord(structuredClone(workflow), 'shallow unit workflow');
        delete recordAt(stepNamed(jobAt(shallowUnit, 'unit'), 'Checkout'), 'with')['fetch-depth'];
        expect(() => assertUnitProvenanceHistory(shallowUnit)).toThrow(
            'unit must retain complete history for immutable measurement provenance'
        );

        for (const jobName of ['lint', 'boundaries']) {
            const broadened = asRecord(structuredClone(workflow), `${jobName} full-history workflow`);
            stepNamed(jobAt(broadened, jobName), 'Checkout').with = { 'fetch-depth': 0 };
            expect(() => assertUnitProvenanceHistory(broadened)).toThrow(`${jobName} must not fetch complete history`);
        }
    });

    it('requires every gate dependency to have succeeded or been skipped', () => {
        const gateScript = assertGateContract(workflow);
        expect(runGateScript(gateScript, gateResults(workflow, 'success'))).toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'skipped'))).toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'failure'))).not.toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'cancelled'))).not.toBe(0);
        const renamedGate = asRecord(structuredClone(workflow), 'renamed gate workflow');
        jobAt(renamedGate, 'gate').name = 'Health summary';
        expect(() => assertGateContract(renamedGate)).toThrow('the Gate job must always report under its stable name');
    });

    it('runs a trusted, credentialless scanner over the untrusted target history', () => {
        expect(() => assertCredentiallessScanner(workflow)).not.toThrow();
        const targetControlledScanner = asRecord(structuredClone(workflow), 'target-controlled scanner workflow');
        recordAt(stepNamed(jobAt(targetControlledScanner, 'secrets'), 'Checkout trusted scanner'), 'with').ref =
            SCAN_TARGET_REF;
        expect(() => assertCredentiallessScanner(targetControlledScanner)).toThrow(
            'secret scanner must come from the trusted base and retain no credentials'
        );
        const tokenBearingScanner = asRecord(structuredClone(workflow), 'token-bearing scanner workflow');
        jobAt(tokenBearingScanner, 'secrets').env = { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(tokenBearingScanner)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });
});
