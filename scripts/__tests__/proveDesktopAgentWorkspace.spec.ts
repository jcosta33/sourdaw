import { describe, expect, it } from 'vitest';

import { type ProofPhase, type ProofStep } from '../desktopAgentWorkspaceDrive.ts';
import {
    buildAgentProofRecord,
    decideVerdict,
    describeVerdict,
    parseArgs,
    type AgentProofVerdict,
} from '../proveDesktopAgentWorkspace.ts';

const PAYLOAD = { sha256: 'abc123', mtime: '2026-09-11T00:00:00.000Z', files: ['Contents/Resources/app.asar'] };

const STREAMING_STEP = 'stream a chat answer from the admitted loopback endpoint';

function ok(phase: ProofPhase, name: string): ProofStep {
    return { name, phase, ok: true, observed: `${name} held` };
}

function failed(phase: ProofPhase, name: string, observed: string): ProofStep {
    return { name, phase, ok: false, observed };
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
        expect(
            decideVerdict([ok('workspace', 'open the agent workspace'), ok('workspace', 'end the comparison')])
        ).toBe('proven');
    });

    it('reports failed when any workspace step observed the wrong state, wherever it sits', () => {
        const steps = [
            ok('workspace', 'open the agent workspace'),
            failed('workspace', 'confirm the proposal', 'saw 2 armable tracks'),
        ];

        expect(decideVerdict(steps)).toBe('failed');
        expect(decideVerdict([...steps].reverse())).toBe('failed');
    });

    it('reports failed when the streaming step never saw the endpoint answer', () => {
        const steps = [
            ok('launch', 'dismiss the alpha notice'),
            ok('workspace', 'admit the loopback provider through Preferences'),
            failed('workspace', STREAMING_STEP, 'the endpoint served completionRequests=0'),
        ];

        expect(decideVerdict(steps)).toBe('failed');
    });

    it('reports not-run when a launch step failed before any workspace step was recorded', () => {
        const steps = [
            ok('launch', 'wait for the workspace or the launch screen'),
            failed('launch', 'dismiss the onboarding tour', 'the tour is still up'),
        ];

        expect(decideVerdict(steps)).toBe('not-run');
    });

    it('reports not-run when the drive stopped at the very first launch step', () => {
        const steps = [failed('launch', 'wait for the workspace or the launch screen', 'neither ever appeared')];

        expect(decideVerdict(steps)).toBe('not-run');
    });
});

describe('describeVerdict', () => {
    it('names the failing step and what it saw', () => {
        const steps = [
            ok('workspace', 'open the agent workspace'),
            failed('workspace', 'revert the change', 'expected 1, saw 4'),
        ];

        expect(describeVerdict(steps, 'failed')).toBe('the step "revert the change" observed expected 1, saw 4');
    });

    it('names the failing launch step behind a not-run verdict', () => {
        const steps = [failed('launch', 'dismiss the alpha notice', 'the notice is still up')];

        expect(describeVerdict(steps, decideVerdict(steps))).toBe(
            'the step "dismiss the alpha notice" observed the notice is still up'
        );
    });

    it('says nothing was driven when the drive took no step at all', () => {
        expect(describeVerdict([], 'not-run')).toBe('the packaged app was never driven');
    });

    it('counts the steps a proven run took', () => {
        expect(describeVerdict([ok('workspace', 'one'), ok('workspace', 'two')], 'proven')).toBe(
            'every one of the 2 workspace steps observed the state it names'
        );
    });
});

describe('buildAgentProofRecord', () => {
    const steps = [
        ok('launch', 'dismiss the alpha notice'),
        failed('workspace', 'revert the change', 'expected 1, saw 4'),
    ];
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
                {
                    name: 'dismiss the alpha notice',
                    phase: 'launch',
                    ok: true,
                    observed: 'dismiss the alpha notice held',
                },
                { name: 'revert the change', phase: 'workspace', ok: false, observed: 'expected 1, saw 4' },
            ],
            verdict: 'failed',
            reason: 'the step "revert the change" observed expected 1, saw 4',
        });
    });

    it('copies the steps so a later mutation of the drive log cannot rewrite a written record', () => {
        steps[0]!.observed = 'rewritten after the fact';

        expect(record.steps[0]?.observed).toBe('dismiss the alpha notice held');
    });
});
