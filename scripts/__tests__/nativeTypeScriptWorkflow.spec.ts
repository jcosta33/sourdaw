// @vitest-environment node

import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name: string; run?: string };
type Job = { if?: string; 'runs-on': string; needs?: string[]; steps: Step[] };
type Workflow = { jobs: Record<string, Job> };

function workflow(name: string): Workflow {
    return parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
}

it('prepares typed lint and unit consumers explicitly inside the account that executes them', () => {
    for (const name of ['validation', 'nightly']) {
        const { jobs } = workflow(name);
        for (const job of [jobs.lint, ...(name === 'validation' ? [jobs['tooling-unit']] : [])]) {
            const install = job.steps.findIndex((step) => step.name === 'Install dependencies');
            const prepare = job.steps.findIndex((step) => step.run === 'pnpm native:typescript:prepare');
            expect(prepare).toBeGreaterThan(install);
            expect(prepare).toBeLessThan(job.steps.length - 1);
        }
        const isolated = jobs.unit.steps;
        const install = isolated.findIndex((step) =>
            step.run?.startsWith('node scripts/runIsolatedUnitShard.ts install')
        );
        const prepare = isolated.findIndex((step) =>
            step.run?.startsWith('node scripts/runIsolatedUnitShard.ts native-compiler')
        );
        const shard = isolated.findIndex((step) => step.name === 'Run shard');
        expect(prepare).toBeGreaterThan(install);
        expect(prepare).toBeLessThan(shard);
    }
});

it('requires cold native compiler preparation and real ACL tests on a selected Windows runner', () => {
    const { jobs } = workflow('validation');
    const job = jobs['native-typescript-windows'];
    expect(job).toBeDefined();
    expect(job['runs-on']).toBe('windows-latest');
    expect(job.if).toBe("needs.decide.outputs.code == 'true'");
    const prepare = job.steps.findIndex((step) => step.run === 'pnpm native:typescript:prepare');
    const test = job.steps.findIndex(
        (step) => step.run === 'pnpm test:run scripts/__tests__/nativeTypeScriptWindowsCache.spec.ts'
    );
    expect(prepare).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(prepare);
    const gate = jobs['validation-gate'];
    expect(gate.needs).toContain('native-typescript-windows');
    const assertion = gate.steps.find((step) => step.name === 'Require selected validation jobs to succeed')?.run;
    expect(assertion).toContain('.["native-typescript-windows"].result == selected(.decide.outputs.code)');
});
