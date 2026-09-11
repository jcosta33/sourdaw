import { describe, expect, it } from 'vitest';

import { type ProofStep } from '../desktopAgentWorkspaceDrive.ts';
import {
    buildAgentProofRecord,
    decideVerdict,
    describeVerdict,
    parseArgs,
    type AgentProofVerdict,
} from '../proveDesktopAgentWorkspace.ts';

const PAYLOAD = { sha256: 'abc123', mtime: '2026-09-11T00:00:00.000Z', files: ['Contents/Resources/app.asar'] };

function ok(name: string): ProofStep {
    return { name, ok: true, observed: `${name} held` };
}

function failed(name: string, observed: string): ProofStep {
    return { name, ok: false, observed };
}

describe('parseArgs', () => {
    it('falls back to the packaged app path the latency harness also defaults to', () => {
        expect(parseArgs(['node', 'proveDesktopAgentWorkspace.ts'])).toEqual({
            appPath: 'release/desktop/mac-arm64/Sourdaw.app',
            jsonPath: null,
        });
    });

    it('reads both flags', () => {
        expect(parseArgs(['node', 'script', '--app', '/tmp/Other.app', '--json', '/tmp/proof.json'])).toEqual({
            appPath: '/tmp/Other.app',
            jsonPath: '/tmp/proof.json',
        });
    });

    it('refuses a flag whose value is the next flag rather than silently taking it', () => {
        expect(() => parseArgs(['node', 'script', '--app', '--json', '/tmp/proof.json'])).toThrow(
            '--app needs a value'
        );
    });

    it('refuses a trailing flag with no value at all', () => {
        expect(() => parseArgs(['node', 'script', '--json'])).toThrow('--json needs a value');
    });
});

describe('decideVerdict', () => {
    it('reports not-run when the drive took no step', () => {
        expect(decideVerdict([])).toBe('not-run');
    });

    it('reports proven when every step held', () => {
        expect(decideVerdict([ok('open the agent workspace'), ok('end the comparison')])).toBe('proven');
    });

    it('reports failed when any step observed the wrong state, wherever it sits', () => {
        const steps = [ok('open the agent workspace'), failed('confirm the proposal', 'saw 2 armable tracks')];

        expect(decideVerdict(steps)).toBe('failed');
        expect(decideVerdict([...steps].reverse())).toBe('failed');
    });
});

describe('describeVerdict', () => {
    it('names the failing step and what it saw', () => {
        const steps = [ok('open the agent workspace'), failed('revert the change', 'expected 1, saw 4')];

        expect(describeVerdict(steps, 'failed')).toBe('the step "revert the change" observed expected 1, saw 4');
    });

    it('counts the steps a proven run took', () => {
        expect(describeVerdict([ok('one'), ok('two')], 'proven')).toBe(
            'every one of the 2 workspace steps observed the state it names'
        );
    });
});

describe('buildAgentProofRecord', () => {
    const steps = [ok('open the agent workspace'), failed('revert the change', 'expected 1, saw 4')];
    const verdict: AgentProofVerdict = 'failed';

    const record = buildAgentProofRecord({
        checkoutGitSha: 'deadbeef',
        payload: PAYLOAD,
        startedAt: '2026-09-11T10:00:00.000Z',
        steps,
        verdict,
        reason: describeVerdict(steps, verdict),
    });

    it('carries the machine, the artefact and the verdict the run earned', () => {
        expect(record).toEqual({
            schemaVersion: 1,
            checkoutGitSha: 'deadbeef',
            appPayloadSha256: 'abc123',
            startedAt: '2026-09-11T10:00:00.000Z',
            steps: [
                { name: 'open the agent workspace', ok: true, observed: 'open the agent workspace held' },
                { name: 'revert the change', ok: false, observed: 'expected 1, saw 4' },
            ],
            verdict: 'failed',
            reason: 'the step "revert the change" observed expected 1, saw 4',
        });
    });

    it('copies the steps so a later mutation of the drive log cannot rewrite a written record', () => {
        steps[0]!.observed = 'rewritten after the fact';

        expect(record.steps[0]?.observed).toBe('open the agent workspace held');
    });
});
