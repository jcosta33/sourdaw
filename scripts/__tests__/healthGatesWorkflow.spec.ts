import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

type UnknownRecord = Record<string, unknown>;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowSource = readFileSync(join(repositoryRoot, '.github/workflows/health-gates.yml'), 'utf8');
const workflow = asRecord(parseDocument(workflowSource).toJS(), 'workflow');

function asRecord(value: unknown, label: string): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as UnknownRecord;
}

function recordAt(record: UnknownRecord, key: string): UnknownRecord {
    return asRecord(record[key], key);
}

function job(name: string): UnknownRecord {
    return recordAt(recordAt(workflow, 'jobs'), name);
}

function stepNamed(owner: UnknownRecord, name: string): UnknownRecord {
    const steps = owner.steps;
    if (!Array.isArray(steps)) {
        throw new TypeError('job steps must be an array');
    }
    const step = steps.find((candidate: unknown) => asRecord(candidate, 'step').name === name);
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

describe('health gates workflow contract', () => {
    it('should subscribe to submitted reviews while preserving pull-request and dispatch events', () => {
        const events = recordAt(workflow, 'on');

        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(recordAt(workflow, 'permissions')).toEqual({ contents: 'read' });
    });

    it('should select heavy secret scanning only for approved review, schedule, and dispatch scopes', () => {
        const decide = job('decide');
        const scope = stringAt(stepNamed(decide, 'Resolve scope'), 'run');

        expect(decide.if).toBe("github.event_name != 'pull_request_review' || github.event.review.state == 'approved'");
        expect(scope).toContain('if [ "$EVENT" = "schedule" ] || [ "$EVENT" = "workflow_dispatch" ]; then');
        expect(scope).toContain("printf 'heavy=true\\nrust=true\\nserver=true\\ne2e=true\\nweb=true\\n'");
        expect(scope).toContain('heavy=false');
        expect(scope).toContain('if [ "$EVENT" = "pull_request_review" ]; then heavy=true; fi');
        expect(job('secrets').if).toBe("needs.decide.outputs.heavy == 'true'");

        const gate = job('gate');
        expect(gate.if).toBe('always()');
        expect(stringAt(stepNamed(gate, 'Require every job to have succeeded or been skipped'), 'run')).toContain(
            '.value.result != "success" and .value.result != "skipped"'
        );
    });

    it('should run a checksum-pinned event-independent scanner without credentials or secrets', () => {
        const secrets = job('secrets');
        const checkout = stepNamed(secrets, 'Checkout');
        const install = stepNamed(secrets, 'Install Gitleaks');
        const scan = stepNamed(secrets, 'Scan history for secrets');
        const installEnvironment = recordAt(install, 'env');
        const installCommand = stringAt(install, 'run');

        expect(secrets.permissions).toBeUndefined();
        expect(recordAt(checkout, 'with')).toMatchObject({
            'fetch-depth': 0,
            'persist-credentials': false,
        });
        expect(install.uses).toBeUndefined();
        expect(installEnvironment.GITLEAKS_VERSION).toBe('8.30.1');
        expect(installEnvironment.GITLEAKS_LINUX_X64_SHA256).toBe(
            '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
        );
        expect(installCommand).toContain(
            'https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz'
        );
        expect(installCommand).toContain('sha256sum --check --strict -');
        expect(installCommand).not.toMatch(/github\.event|GITHUB_TOKEN|\$\{\{\s*secrets\./);
        expect(scan).toMatchObject({
            run: 'gitleaks git --redact --no-banner --verbose .',
        });
        expect(scan.uses).toBeUndefined();
        expect(scan.env).toBeUndefined();
        expect(JSON.stringify(secrets)).not.toMatch(/GITHUB_TOKEN|\$\{\{\s*secrets\./);
    });
});
