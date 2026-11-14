/**
 * The required `Gate` boundary, shared by both health-gate harnesses. `health-gates.yml` mints
 * `Gate` from pull-request events that open, update, reopen, or change draft state. Heavy checks
 * run only for a non-draft pull request. `Gate` always runs and fails for a draft, a cancellation,
 * or a failed selected check, because GitHub treats a skipped required check as passing.
 */

export const REQUIRED_CHECK_NAME = 'Gate';
export const HEALTH_GATES_EVENTS = {
    pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft'] },
} as const;
export const GATE_CONDITION = '${{ always() }}';
export const GATE_STEP = 'Require selected checks to succeed';
export const NON_DRAFT_CONDITION = 'github.event.pull_request.draft == false';
export const DRAFT_GATE_CLAUSE = 'pull request is a draft';
export const GATE_DRAFT_ENV = '${{ github.event.pull_request.draft }}';

type WorkflowRecord = Record<string, unknown>;

function asWorkflowRecord(value: unknown, label: string): WorkflowRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as WorkflowRecord;
}

function workflowJobs(workflow: unknown, file: string): WorkflowRecord {
    return asWorkflowRecord(asWorkflowRecord(workflow, file).jobs, `${file} jobs`);
}

function namedStep(job: WorkflowRecord, name: string, label: string): WorkflowRecord {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const step: unknown = steps.find((candidate: unknown) => asWorkflowRecord(candidate, label).name === name);
    return asWorkflowRecord(step, `${label} step ${name}`);
}

function sameValue(actual: unknown, expected: unknown): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

/** GitHub names an unnamed job's check run after its job id. */
// GitHub names a job's check run after its key when `name` is absent or empty.
export function workflowJobCheckName(jobId: string, job: unknown): string {
    const name = asWorkflowRecord(job, jobId).name;
    return typeof name === 'string' && name !== '' ? name : jobId;
}

function assertGateCannotSkip(gate: WorkflowRecord): void {
    if (gate.name !== REQUIRED_CHECK_NAME || gate.if !== GATE_CONDITION || gate['continue-on-error'] !== undefined) {
        throw new Error('Gate must run after cancellation');
    }
    const step = namedStep(gate, GATE_STEP, 'gate');
    if (step.if !== GATE_CONDITION || step['continue-on-error'] !== undefined) {
        throw new Error('Gate must run after cancellation');
    }
    const needs = Array.isArray(gate.needs) ? gate.needs : [];
    const run = typeof step.run === 'string' ? step.run : '';
    if (needs.includes('admission') || run.includes('.admission.') || !run.includes(DRAFT_GATE_CLAUSE)) {
        throw new Error('Gate must fail when the pull request is a draft');
    }
    const env = asWorkflowRecord(step.env, 'gate env');
    if (env.DRAFT !== GATE_DRAFT_ENV) {
        throw new Error('Gate must read the event draft flag');
    }
    for (const job of ['scope', 'e2e-build', 'validation', 'affected', 'codeql', 'desktop-packaging']) {
        if (!needs.includes(job)) {
            throw new Error('Gate must fail unless the selected checks succeeded');
        }
    }
}

function assertNonDraftHeavyChecks(jobs: WorkflowRecord): void {
    const scope = asWorkflowRecord(jobs.scope, 'scope');
    if (scope.if !== NON_DRAFT_CONDITION || scope['continue-on-error'] !== undefined) {
        throw new Error('the heavy checks must run only for a non-draft pull request');
    }
    for (const [jobId, job] of Object.entries(jobs)) {
        if (jobId === 'scope' || jobId === 'gate') {
            continue;
        }
        const record = asWorkflowRecord(job, jobId);
        const needs = record.needs;
        const waitsForScope = needs === 'scope' || (Array.isArray(needs) && needs.includes('scope'));
        if (!waitsForScope) {
            throw new Error(`health-gates.yml job ${jobId} must wait for the non-draft scope`);
        }
        if (jobId === 'e2e-build' || jobId === 'affected' || jobId === 'desktop-packaging') {
            const condition = typeof record.if === 'string' ? record.if : '';
            if (!condition.includes(NON_DRAFT_CONDITION)) {
                throw new Error('the heavy checks must run only for a non-draft pull request');
            }
        }
    }
}

/**
 * The required-check boundary. GitHub counts a `skipped` conclusion as satisfying a required check
 * and prefers the newest run of its name, so: only a pull_request run of `health-gates.yml` may
 * mint `Gate`; `Gate` always runs and fails for a draft; every heavy job waits for the non-draft
 * scope; and no other workflow mints `Gate`.
 */
export function assertPullRequestGateWorkflows(workflows: Readonly<Record<string, unknown>>): void {
    if (workflows['pr-checks.yml'] !== undefined) {
        throw new Error('pr-checks.yml must not exist; pull-request CI is health-gates.yml');
    }
    const health = asWorkflowRecord(workflows['health-gates.yml'], 'health-gates.yml');
    if (!sameValue(health.on, HEALTH_GATES_EVENTS)) {
        throw new Error(
            'health-gates.yml must answer to pull_request open, push, reopen, and draft-state events alone, or a skipped Gate can satisfy the required check'
        );
    }
    const jobs = workflowJobs(health, 'health-gates.yml');
    assertGateCannotSkip(asWorkflowRecord(jobs.gate, 'gate'));
    assertNonDraftHeavyChecks(jobs);
    for (const [file, workflow] of Object.entries(workflows)) {
        if (file === 'health-gates.yml') {
            continue;
        }
        for (const [jobId, job] of Object.entries(workflowJobs(workflow, file))) {
            if (workflowJobCheckName(jobId, job) === REQUIRED_CHECK_NAME) {
                throw new Error(`${file} must not name a job ${REQUIRED_CHECK_NAME}`);
            }
        }
    }
}
