/**
 * The credential and authority surface of every registered workflow, shared by
 * both health-gate harnesses: which jobs may hold a job-level token grant,
 * which may read which secrets, which may name a deployment environment, which
 * checkouts must not persist the job token, which action refs are immutable,
 * and the one job that may be named `Gate`. Each property is its own pin, so a deliberate edit to one changes one
 * pin and a review reads that pin's diff.
 */

import { HEALTH_GATE_WORKFLOW_FILES } from './healthGateWorkflowContract.ts';

type JobPins<Value> = Readonly<Record<string, Readonly<Record<string, Value>>>>;

const CODEQL_PERMISSIONS = { contents: 'read', 'security-events': 'write', actions: 'read' } as const;

// A job-level `permissions` block reshapes one leg's token away from the
// workflow-level pin: `contents: write` on a validation leg would hand every
// pull request a token that can push. Every job in every registered file
// inherits the workflow-level grant except these, each pinned exactly: the
// CodeQL SARIF uploads, the nightly failure reporter, and the semantic-review
// coverage job.
export const JOB_PERMISSION_PINS: JobPins<Readonly<Record<string, string>>> = {
    'health-gates.yml': { codeql: CODEQL_PERMISSIONS },
    'nightly.yml': { codeql: CODEQL_PERMISSIONS, 'nightly-report': { contents: 'read', issues: 'write' } },
    'semantic-review.yml': { coverage: { contents: 'read' } },
};

// The only jobs that may read a secret or the job token, each pinned to the
// exact names it reads.
// A secret anywhere else — workflow, job, or step `env`, an action input, a
// condition, or `secrets: inherit` into a reusable workflow — hands a credential
// to code that never needed one, and on a pull-request trigger to the head's code.
export const SECRET_REFERENCE_PINS: JobPins<readonly string[]> = {
    'health-gates.yml': { admission: ['GITHUB_TOKEN'] },
    'nightly.yml': {
        'deploy-web': ['GITHUB_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'VERCEL_TOKEN'],
        'nightly-report': ['GITHUB_TOKEN'],
    },
    'semantic-review.yml': { assess: ['GITHUB_TOKEN', 'JEV_KEY'] },
};

// A deployment environment unlocks that environment's own secrets and
// protection rules, so only the production deploy may name one.
export const JOB_ENVIRONMENT_PINS: JobPins<string> = {
    'nightly.yml': { 'deploy-web': 'Production' },
};

// Checkouts that must not leave the job token in the cloned repository's git
// config, where every later step — including the head's own scripts — can read
// it. Dropping the key restores the action's default, which persists it.
export const CREDENTIALLESS_CHECKOUTS: JobPins<readonly string[]> = {
    'health-gates.yml': { admission: ['Checkout trusted admission'], scope: ['Checkout'] },
    'nightly.yml': {
        unit: ['Checkout'],
        secrets: ['Checkout trusted scanner', 'Checkout scan target'],
        'deploy-web': ['Checkout the validated revision'],
        'nightly-report': ['Checkout'],
    },
    'pr-checks.yml': { scope: ['Checkout'] },
    'quantum-measurements.yml': { measure: ['Checkout source head'] },
    'semantic-review.yml': { assess: ['Checkout the trusted revision'] },
    'validation.yml': {
        unit: ['Checkout'],
        'native-macos': ['Checkout'],
        'pr-secrets': ['Checkout trusted scanner', 'Checkout scan target'],
    },
    'wasm-artifacts.yml': { 'build-artifacts': ['Checkout workflow control', 'Checkout source head'] },
};

// `Gate` is the one required context, and GitHub satisfies it with the newest
// check run of that name, so exactly one job may carry it. An unnamed job's
// check run is named after its id.
export const REQUIRED_CHECK_NAME = 'Gate';
export const REQUIRED_CHECK_OWNER = { workflow: 'health-gates.yml', job: 'gate' } as const;

// GitHub evaluates expressions in a job's `name`, so `${{ 'Ga' }}te` mints a
// check named Gate that no literal comparison sees. These are the only job
// names that may carry an expression, each pinned exactly; every one opens with
// a literal prefix, so no matrix value or output can evaluate it to Gate.
export const JOB_NAME_EXPRESSION_PINS: JobPins<string> = {
    'heavy-gates.yml': { e2e: 'Affected end-to-end ${{ matrix.id }}' },
    'nightly.yml': { unit: 'Unit suite ${{ matrix.shard }}/4', e2e: 'End-to-end ${{ matrix.shard }}/12' },
    'semantic-review.yml': {
        coverage: "Jev coverage · ${{ needs.assess.outputs.coverage || 'no assessment delivered' }}",
    },
    'validation.yml': { unit: 'Unit suite ${{ matrix.shard }}/4' },
};

type WorkflowRecord = Readonly<Record<string, unknown>>;

function workflowRecord(value: unknown, label: string): WorkflowRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return Object.fromEntries(Object.entries(value));
}

function sameJson(actual: unknown, expected: unknown): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

// Every expression a value carries: each `${{ … }}` in a string, and a whole
// `if` condition, which GitHub evaluates as an expression without the wrapper.
function expressionsIn(value: unknown, key = ''): string[] {
    if (typeof value === 'string') {
        const wrapped = Array.from(value.matchAll(/\$\{\{([\s\S]*?)\}\}/g), (match) => match[1] ?? '');
        return key === 'if' ? [value, ...wrapped] : wrapped;
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => expressionsIn(entry));
    }
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([entryKey, entry]) => expressionsIn(entry, entryKey));
    }
    return [];
}

// The secret names a value reads, matched case-insensitively as GitHub matches
// contexts. `github.token` is the job token `secrets.GITHUB_TOKEN` names, so
// both count as GITHUB_TOKEN. Reading either context whole (`toJSON(secrets)`,
// `secrets[name]`, `toJSON(github)`, `github[name]`) is reported as `*`, which
// no pin admits.
function secretNamesIn(value: unknown): string[] {
    const names = expressionsIn(value).flatMap((expression) => [
        ...Array.from(
            expression.matchAll(/\bsecrets\b(\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/gi),
            (match) => match[2]?.toUpperCase() ?? '*'
        ),
        ...Array.from(expression.matchAll(/\bgithub\s*\.\s*token\b/gi), () => 'GITHUB_TOKEN'),
        ...Array.from(expression.matchAll(/\bgithub\s*[[)]/gi), () => '*'),
    ]);
    return [...new Set(names)].sort();
}

function jobsOf(file: string, workflow: unknown): Array<readonly [string, WorkflowRecord]> {
    const jobs = workflowRecord(workflowRecord(workflow, file).jobs, `${file} jobs`);
    return Object.entries(jobs).map(([jobId, job]) => [jobId, workflowRecord(job, `${file} job ${jobId}`)] as const);
}

function registeredWorkflows(workflows: Readonly<Record<string, unknown>>): Array<readonly [string, unknown]> {
    return HEALTH_GATE_WORKFLOW_FILES.map((file) => {
        if (workflows[file] === undefined) {
            throw new Error(`${file} is missing from the workflows under assertion`);
        }
        return [file, workflows[file]] as const;
    });
}

export function assertJobLevelPermissions(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        for (const [jobId, job] of jobsOf(file, workflow)) {
            const pinned = JOB_PERMISSION_PINS[file]?.[jobId];
            if (pinned === undefined && job.permissions !== undefined) {
                throw new Error(`${file} job ${jobId} must inherit the workflow-level permissions`);
            }
            if (pinned !== undefined && !sameJson(job.permissions, pinned)) {
                throw new Error(`${file} job ${jobId} must keep exactly its pinned permissions`);
            }
        }
    }
}

export function assertSecretReferences(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        const outsideJobs = Object.entries(workflowRecord(workflow, file)).filter(([key]) => key !== 'jobs');
        if (secretNamesIn(outsideJobs).length > 0) {
            throw new Error(`${file} must not read a secret outside a pinned job`);
        }
        for (const [jobId, job] of jobsOf(file, workflow)) {
            if (job.secrets !== undefined) {
                throw new Error(`${file} job ${jobId} must not pass secrets to a reusable workflow`);
            }
            const expected = SECRET_REFERENCE_PINS[file]?.[jobId] ?? [];
            if (!sameJson(secretNamesIn(job), [...expected].sort())) {
                throw new Error(
                    `${file} job ${jobId} must read exactly its pinned secrets: ${expected.join(', ') || 'none'}`
                );
            }
        }
    }
}

// A job names its environment as a string or as a mapping with a `name`.
function environmentName(environment: unknown): unknown {
    if (environment !== null && typeof environment === 'object' && !Array.isArray(environment)) {
        return workflowRecord(environment, 'environment').name;
    }
    return environment;
}

export function assertJobEnvironments(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        for (const [jobId, job] of jobsOf(file, workflow)) {
            const expected = JOB_ENVIRONMENT_PINS[file]?.[jobId];
            if (environmentName(job.environment) === expected) {
                continue;
            }
            if (expected === undefined) {
                throw new Error(`${file} job ${jobId} must not name a deployment environment`);
            }
            throw new Error(`${file} job ${jobId} must keep its pinned ${expected} environment`);
        }
    }
}

function stepsOf(file: string, jobId: string, job: WorkflowRecord | undefined): WorkflowRecord[] {
    if (!Array.isArray(job?.steps)) {
        return [];
    }
    return job.steps.map((entry: unknown) => workflowRecord(entry, `${file} job ${jobId} step`));
}

function isCredentiallessCheckout(step: WorkflowRecord | undefined): boolean {
    if (typeof step?.uses !== 'string' || !step.uses.startsWith('actions/checkout@')) {
        return false;
    }
    return step.with !== undefined && workflowRecord(step.with, 'checkout inputs')['persist-credentials'] === false;
}

export function assertCredentiallessCheckouts(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        const jobs = new Map(jobsOf(file, workflow));
        for (const [jobId, stepNames] of Object.entries(CREDENTIALLESS_CHECKOUTS[file] ?? {})) {
            const steps = stepsOf(file, jobId, jobs.get(jobId));
            for (const stepName of stepNames) {
                if (!isCredentiallessCheckout(steps.find((step) => step.name === stepName))) {
                    throw new Error(
                        `${file} job ${jobId} step ${stepName} must check out with persist-credentials: false`
                    );
                }
            }
        }
    }
}

export function assertRequiredCheckNameExclusive(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        for (const [jobId, job] of jobsOf(file, workflow)) {
            const pinnedExpression = JOB_NAME_EXPRESSION_PINS[file]?.[jobId];
            if (typeof job.name === 'string' && job.name.includes('${{') && job.name !== pinnedExpression) {
                throw new Error(`${file} job ${jobId} must not compute its check name from an expression`);
            }
            const owner = file === REQUIRED_CHECK_OWNER.workflow && jobId === REQUIRED_CHECK_OWNER.job;
            if (!owner && (job.name ?? jobId) === REQUIRED_CHECK_NAME) {
                throw new Error(
                    `${file} job ${jobId} must not be named ${REQUIRED_CHECK_NAME}; only the ${REQUIRED_CHECK_OWNER.workflow} ${REQUIRED_CHECK_OWNER.job} job may mint that check`
                );
            }
        }
    }
}

// A `uses` ref runs whatever it names at run time, and a tag or branch can move
// under the workflow to code nobody reviewed. Only a full commit SHA, or a path
// inside this repository, pins what runs.
const PINNED_ACTION_REF = /^[^\s@]+@[0-9a-f]{40}$/;

function isPinnedActionRef(ref: unknown): boolean {
    return typeof ref === 'string' && (ref.startsWith('./') || PINNED_ACTION_REF.test(ref));
}

export function assertPinnedActions(workflows: Readonly<Record<string, unknown>>): void {
    for (const [file, workflow] of registeredWorkflows(workflows)) {
        for (const [jobId, job] of jobsOf(file, workflow)) {
            const refs = [job.uses, ...stepsOf(file, jobId, job).map((step) => step.uses)];
            for (const ref of refs.filter((candidate) => candidate !== undefined)) {
                if (!isPinnedActionRef(ref)) {
                    throw new Error(
                        `${file} job ${jobId} must pin ${JSON.stringify(ref)} to a full commit SHA or a local ./ path`
                    );
                }
            }
        }
    }
}

// The credential and authority surface of every registered workflow, named
// property by property so a deliberate edit to one changes one pin.
export function assertWorkflowSecuritySurface(workflows: Readonly<Record<string, unknown>>): void {
    assertJobLevelPermissions(workflows);
    assertSecretReferences(workflows);
    assertJobEnvironments(workflows);
    assertCredentiallessCheckouts(workflows);
    assertPinnedActions(workflows);
    assertRequiredCheckNameExclusive(workflows);
}
