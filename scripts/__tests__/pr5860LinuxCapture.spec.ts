import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
            "github.event.pull_request.number == 5860 && github.event.pull_request.head.repo.full_name == github.repository && github.event.before == 'bd71bfabe515f4151fbe4b6d9faab62a1520568d' && github.run_attempt == 1 && github.event.pull_request.head.ref == 'build/pnpm-private-store'"
        );
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(step('Checkout diagnostic control').with?.['persist-credentials']).toBe(false);
        expect(step('Checkout frozen integration').with).toMatchObject({
            ref: 'afa60d33e745251ab041492132f95f26b15542e6',
            'persist-credentials': false,
        });
    });

    it('requires frozen source and original collection before the unchanged shard command', () => {
        expect(step('Verify frozen source').run).toContain('5a5ba3149e33fa780d769205b1aa3a94b411e228');
        expect(step('Verify frozen source after capture').run).toContain('git status --porcelain --untracked-files=no');
        expect(steps.indexOf(step('Prepare shard selection'))).toBeLessThan(
            steps.indexOf(step('Verify original collection'))
        );
        expect(step('Prepare shard selection').run).toContain("E2E_SPECS='+JSON.stringify(b.specs)");
        expect(steps.indexOf(step('Verify original collection'))).toBeLessThan(
            steps.indexOf(step('Run original shard'))
        );
        expect(step('Run original shard').run).toContain('node scripts/prValidationScope.ts run');
        expect(step('Retain capture').if).toBe('${{ always() }}');
        expect(step('Sample memory after shard').if).toBe('${{ always() }}');
        expect(step('Run original shard').run).toContain('unset DEBUG DEBUG_FILE MAX_LOG_LENGTH NODE_OPTIONS');
        expect(step('Verify original collection').run).toContain('unset DEBUG DEBUG_FILE MAX_LOG_LENGTH NODE_OPTIONS');
        expect(step('Retain capture').with?.path).toContain('source/blob-report/');
        expect(step('Retain capture').with?.path).toContain('source/test-results/');
        expect(step('Retain capture').with?.path).toContain('observer/');
        expect(step('Run original shard').run).toContain('DIAGNOSTIC_CANARY_SCOPE_ROOT');
        expect(step('Run original shard').run).toContain('sha256sum -c -');
        expect(step('Run original shard').run).toContain('verify-observation.cjs');
        expect(step('Run original shard').run).toContain('exit "${results[0]}"');
        expect(createHash('sha256').update(readFileSync('.github/diagnostics/5860/observer.cjs')).digest('hex')).toBe(
            'b510bcc64d0dd0b27d3036cc981b5b5d274f8abbefe86d75d605b288c0d8e1d9'
        );
    });

    it('rejects incomplete, foreign, or non-target observation records', () => {
        const result = spawnSync(
            'node',
            [
                '-e',
                `
            const assert=require('node:assert/strict');
            const {verify}=require('./.github/diagnostics/5860/verify-observation.cjs');
            const root='/source', rel='tests/e2e/persistedClipEditAcceptance.spec.ts';
            const valid={role:'worker',validHostedTargetObservation:true,targetSeen:true,complete:true,exitObserved:true,canaryOverride:false,sourceRoot:root,scopeRoot:root,observedTarget:{file:root+'/'+rel,relativeFile:rel,sourceRelativeFile:rel,scopeRoot:root,title:'persisted clip edits replay exact owners and source material through real same-tab hydration',project:'chromium-dev'},packageBindings:['@playwright/test','playwright','playwright-core'].map(name=>({name,version:'1.64.1'})),connections:[{admitted:true,browserVersion:'156.0.8078.4'}],connectionsClosed:1,counts:{droppedRecords:0,droppedBytes:0,droppedConnections:0,errors:0}};
            verify(valid,root);
            for (const change of [{role:'cli'},{validHostedTargetObservation:false},{scopeRoot:'/foreign'},{canaryOverride:true},{exitObserved:false},{connectionsClosed:0},{counts:{...valid.counts,errors:1}},{observedTarget:{...valid.observedTarget,relativeFile:'other.spec.ts'}},{connections:[{admitted:true,browserVersion:'153'}]}]) assert.throws(()=>verify({...valid,...change},root));
        `,
            ],
            { encoding: 'utf8' }
        );
        expect(result.status, `${result.error ?? ''}${result.stderr}`).toBe(0);
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
            const entries = Array.from({length: 81}, (_, i) => ({project:'chromium', file:'a.spec.ts', line:i+1, title:['a.spec.ts','case '+i]}));
            const baseline = {count:81,target:entries[0],sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
            const listing = values => values.map(e => '  ['+e.project+'] › tests/e2e/'+e.file+':'+e.line+':1 › '+e.title[1]).join('\\n')+'\\nTotal: 81 tests in 1 file';
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
