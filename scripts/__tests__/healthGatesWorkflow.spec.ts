import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type UnknownRecord = Record<string, unknown>;

const APPROVED_REVIEW_CONDITION =
    "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'";
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const SECRET_SCAN_CONDITION = "needs.decide.outputs.heavy == 'true'";
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
    return stringAt(scope, 'run');
}

function decideAdmits(eventName: string, reviewState: string): boolean {
    assertHeavyScanChain(workflow);
    return eventName !== 'pull_request_review' || reviewState === 'approved';
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

        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(recordAt(workflow, 'permissions')).toEqual({ contents: 'read' });
    });

    it('should execute the complete approved-review heavy-scan chain and preserve ordinary scope', () => {
        const scopeScript = assertHeavyScanChain(workflow);

        expect(decideAdmits('pull_request_review', 'approved')).toBe(true);
        expect(decideAdmits('pull_request_review', 'commented')).toBe(false);
        expect(decideAdmits('pull_request_review', 'changes_requested')).toBe(false);
        expect(decideAdmits('pull_request', '')).toBe(true);
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
        expect(gate.if).toBe('always()');
        expect(stringAt(stepNamed(gate, 'Require every job to have succeeded or been skipped'), 'run')).toContain(
            '.value.result != "success" and .value.result != "skipped"'
        );
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
});
