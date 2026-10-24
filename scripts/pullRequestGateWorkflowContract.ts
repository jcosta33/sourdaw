/**
 * Only ordinary pull-request head events may mint the required Gate. Review and label events
 * cannot supersede its result, and cancellation must fail the aggregate instead of skipping it.
 */
export const REQUIRED_CHECK_NAME = 'Gate';
export const HEALTH_GATES_EVENTS = {
    pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] },
} as const;
export const PR_CHECKS_EVENTS = HEALTH_GATES_EVENTS;
export const GATE_CONDITION = '${{ always() && !github.event.pull_request.draft }}';
export const GATE_STEP_CONDITION = '${{ always() }}';
export const NON_DRAFT_CONDITION = '${{ !github.event.pull_request.draft }}';
export const GATE_STEP = 'Require selected checks to succeed';
const GATE_MEMBERS = ['scope', 'validation', 'affected', 'codeql'];

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

/** GitHub names a job's check run after its key when `name` is absent or empty. */
export function workflowJobCheckName(jobId: string, job: unknown): string {
    const name = asWorkflowRecord(job, jobId).name;
    return typeof name === 'string' && name !== '' ? name : jobId;
}

function assertGateCannotSkip(gate: WorkflowRecord): void {
    if (gate.name !== REQUIRED_CHECK_NAME || gate.if !== GATE_CONDITION || gate['continue-on-error'] !== undefined) {
        throw new Error('Gate must run after cancellation');
    }
    const step = namedStep(gate, GATE_STEP, 'gate');
    if (step.if !== GATE_STEP_CONDITION || step['continue-on-error'] !== undefined) {
        throw new Error('Gate must run after cancellation');
    }
    if (!sameValue(gate.needs, GATE_MEMBERS)) {
        throw new Error('Gate must depend on exactly the selected-check producers');
    }
}

/**
 * GitHub counts a skipped conclusion as satisfying a required check and prefers the newest run
 * of its name. Keep events that could skip the checks out of the workflow that mints Gate, and
 * admit every non-draft PR update while drafts wait for ready_for_review.
 */
export function assertPullRequestRequiredCheck(workflows: Readonly<Record<string, unknown>>): void {
    const health = asWorkflowRecord(workflows['health-gates.yml'], 'health-gates.yml');
    if (!sameValue(health.on, HEALTH_GATES_EVENTS)) {
        throw new Error(
            'health-gates.yml must answer to ordinary pull-request head events alone, or a skipped Gate can satisfy the required check'
        );
    }
    const jobs = workflowJobs(health, 'health-gates.yml');
    assertGateCannotSkip(asWorkflowRecord(jobs.gate, 'gate'));
    const scope = asWorkflowRecord(jobs.scope, 'scope');
    if (scope.needs !== undefined || scope.if !== NON_DRAFT_CONDITION || scope['continue-on-error'] !== undefined) {
        throw new Error('required check planning must run on every non-draft pull-request head event');
    }
    for (const [jobId, job] of Object.entries(jobs)) {
        if (jobId === 'gate' || jobId === 'scope') {
            continue;
        }
        const needs = asWorkflowRecord(job, jobId).needs;
        if (needs !== 'scope' && !(Array.isArray(needs) && needs.includes('scope'))) {
            throw new Error(`health-gates.yml job ${jobId} must wait for scope`);
        }
    }
    const checks = asWorkflowRecord(workflows['pr-checks.yml'], 'pr-checks.yml');
    if (!sameValue(checks.on, PR_CHECKS_EVENTS)) {
        throw new Error('pr-checks.yml must answer to pull-request pushes alone');
    }
    const pushScope = asWorkflowRecord(workflowJobs(checks, 'pr-checks.yml').scope, 'push scope');
    if (pushScope.needs !== undefined || pushScope.if !== NON_DRAFT_CONDITION) {
        throw new Error('cheap check planning must run on every non-draft pull-request head event');
    }
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
