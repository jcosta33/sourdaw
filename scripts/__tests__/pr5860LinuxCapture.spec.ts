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
            "github.event.pull_request.number == 5860 && github.event.before == '7f27b75c01662b62f56a761e204723ec01ddd6ee' && github.run_attempt == 1 && github.event.pull_request.head.ref == 'build/pnpm-private-store'"
        );
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(step('Checkout diagnostic control').with?.['persist-credentials']).toBe(false);
        expect(step('Checkout frozen integration').with).toMatchObject({
            ref: '9936bb98a762d8a5b045e24e8a489aea2963745e',
            'persist-credentials': false,
        });
    });

    it('requires frozen source and original collection before the unchanged shard command', () => {
        expect(step('Verify frozen source').run).toContain('e572f46dfae5c8147d9985a7770d97b4f4883222');
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
        expect(step('Prepare private debug files').run).toContain('${NODE_OPTIONS:+$NODE_OPTIONS }--import=');
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
            const entries = Array.from({length: 88}, (_, i) => ({project:'chromium', file:'a.spec.ts', line:i+1, title:['a.spec.ts','case '+i]}));
            const baseline = {count:88,target:entries[0],sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
            const listing = values => values.map(e => '  ['+e.project+'] › tests/e2e/'+e.file+':'+e.line+':1 › '+e.title[1]).join('\\n')+'\\nTotal: 88 tests in 1 file';
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
