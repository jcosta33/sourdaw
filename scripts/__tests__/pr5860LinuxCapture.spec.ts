import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/pr5860-linux-capture.yml', 'utf8'));
const steps = workflow.jobs.capture.steps as Array<{
    name: string;
    if?: string;
    run?: string;
    with?: Record<string, unknown>;
}>;
const step = (name: string) => steps.find((entry) => entry.name === name)!;

describe('PR 5860 Linux capture', () => {
    it('admits only the intended synchronize event and attempt', () => {
        expect(workflow.on).toEqual({ pull_request: { types: ['synchronize'] } });
        expect(workflow.jobs.capture.if.replaceAll(/\s+/g, ' ').trim()).toBe(
            "github.event.pull_request.number == 5860 && github.event.before == '926e9c05fc6e23e7c6a22a597c21320121aa972e' && github.run_attempt == 1 && github.event.pull_request.head.ref == 'build/pnpm-private-store'"
        );
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(step('Checkout diagnostic control').with?.['persist-credentials']).toBe(false);
        expect(step('Checkout frozen integration').with).toMatchObject({
            ref: 'd68a5fb5d2f57e56f2bc9fa9430d25850edaab3d',
            'persist-credentials': false,
        });
    });

    it('requires frozen source and original collection before the unchanged shard command', () => {
        expect(step('Verify frozen source').run).toContain('bc30ce2f220893808a82f1e966cd789d43f60a63');
        expect(step('Verify frozen source after capture').run).toContain('git status --porcelain --untracked-files=no');
        expect(steps.indexOf(step('Prepare private debug files'))).toBeLessThan(
            steps.indexOf(step('Verify original collection'))
        );
        expect(step('Prepare private debug files').run).toContain("E2E_SPECS='+JSON.stringify(b.specs)");
        expect(steps.indexOf(step('Verify original collection'))).toBeLessThan(
            steps.indexOf(step('Run original shard'))
        );
        expect(step('Run original shard').run).toContain('node scripts/prValidationScope.ts run');
        expect(step('Retain capture').if).toBe('${{ always() }}');
        expect(step('Sample memory after shard').if).toBe('${{ always() }}');
        expect(step('Prepare private debug files').run).not.toContain('NODE_OPTIONS=');
        expect(step('Verify original collection').run).toContain('${NODE_OPTIONS:+$NODE_OPTIONS }--import=');
        expect(step('Run original shard').run).toContain('${NODE_OPTIONS:+$NODE_OPTIONS }--import=');
        expect(step('Run original shard').run).toContain('assert.equal(process.env.DEBUG_FILE');
        expect(step('Run original shard').run).toContain('No per-process debug log was captured');
        expect(step('Run original shard').run).toContain('Protocol output leaked into shard.log');
        expect(step('Run original shard').run).toContain('exit "${results[0]}"');
        expect(step('Retain capture').with?.path).toContain('debug/');
        expect(readFileSync('.github/diagnostics/5860/debug-preload.mjs', 'utf8')).toContain('`${process.pid}.log`');
    });

    it('rejects reordered, missing, and altered test identities', () => {
        const result = spawnSync(
            'node',
            [
                '--input-type=module',
                '-e',
                `
            import assert from 'node:assert/strict';
            import {createHash} from 'node:crypto';
            import {verifyCollection} from './.github/diagnostics/5860/collection-preflight.mjs';
            const entries = Array.from({length: 83}, (_, i) => ({project:'chromium', file:'a.spec.ts', line:i+1, title:['a.spec.ts','case '+i]}));
            const baseline = {count:83,target:entries[0],sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
            const listing = values => values.map(e => '  ['+e.project+'] › tests/e2e/'+e.file+':'+e.line+':1 › '+e.title[1]).join('\\n')+'\\nTotal: 83 tests in 1 file';
            verifyCollection(listing(entries),baseline);
            assert.throws(() => verifyCollection(listing([...entries].reverse()),baseline));
            assert.throws(() => verifyCollection(listing(entries.slice(1)),baseline));
            assert.throws(() => verifyCollection(listing(entries.map((e,i) => i === 2 ? {...e,line:500} : e)),baseline));
        `,
            ],
            { encoding: 'utf8' }
        );
        expect(result.status, `${result.error ?? ''}${result.stderr}`).toBe(0);
    });
});
