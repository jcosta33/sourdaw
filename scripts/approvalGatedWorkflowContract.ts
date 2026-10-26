/**
 * The approval-gated boundary of the required `Gate`, shared by both health-gate harnesses (the
 * vitest spec and the shell harness). Pushes run only `pr-checks.yml`; `health-gates.yml` mints
 * `Gate` from labeled `pull_request` events, and `scripts/ciApprovalAdmission.ts`, run from the
 * default branch, admits only the reviewer App's approval label on its approval of the exact head.
 */

export const REQUIRED_CHECK_NAME = 'Gate';
export const HEALTH_GATES_EVENTS = { pull_request: { types: ['labeled'] } } as const;
export const PR_CHECKS_EVENTS = {
    pull_request: { types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] },
} as const;
export const GATE_CONDITION = '${{ always() }}';
export const GATE_STEP = 'Require selected checks to succeed';
export const ADMITTED_CONDITION = "needs.admission.outputs.admitted == 'true'";
export const ADMISSION_GATE_CLAUSE = '.admission.result == "success" and .admission.outputs.admitted == "true"';
export const ADMISSION_CHECKOUT = {
    ref: '${{ github.event.repository.default_branch }}',
    path: 'trusted',
    'sparse-checkout': 'scripts',
    'persist-credentials': false,
} as const;
export const ADMISSION_DECISION_RUN = 'node trusted/scripts/ciApprovalAdmission.ts';
export const ADMISSION_DECISION_ENV = {
    REVIEWS_PATH: '${{ runner.temp }}/reviews.json',
    HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
    LABEL_NAME: '${{ github.event.label.name }}',
    SENDER_NODE_ID: '${{ github.event.sender.node_id }}',
} as const;
export const ADMISSION_REVIEWS_RUN =
    'gh api --paginate --slurp "repos/$REPOSITORY/pulls/$NUMBER/reviews" > "$RUNNER_TEMP/reviews.json"';

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
    if (needs[0] !== 'admission' || typeof step.run !== 'string' || !step.run.includes(ADMISSION_GATE_CLAUSE)) {
        throw new Error('Gate must fail unless approval admission admitted the head');
    }
}

function assertTrustedAdmission(admission: WorkflowRecord): void {
    for (const softening of ['if', 'continue-on-error', 'permissions', 'needs']) {
        if (admission[softening] !== undefined) {
            throw new Error(`approval admission must not declare ${softening}`);
        }
    }
    if (!sameValue(namedStep(admission, 'Checkout trusted admission', 'admission').with, ADMISSION_CHECKOUT)) {
        throw new Error('approval admission must decide from the default branch, never the candidate head');
    }
    const reviews = namedStep(admission, 'Read reviews', 'admission');
    if (
        reviews.run !== ADMISSION_REVIEWS_RUN ||
        !sameValue(reviews.env, {
            GH_TOKEN: '${{ github.token }}',
            REPOSITORY: '${{ github.repository }}',
            NUMBER: '${{ github.event.pull_request.number }}',
        })
    ) {
        throw new Error('approval admission must read every review of this pull request');
    }
    const decide = namedStep(admission, 'Decide admission', 'admission');
    if (
        decide.id !== 'decide' ||
        decide.run !== ADMISSION_DECISION_RUN ||
        !sameValue(decide.env, ADMISSION_DECISION_ENV)
    ) {
        throw new Error('approval admission must decide on the event head, label and sender with the trusted script');
    }
    if (
        !sameValue(admission.outputs, {
            admitted: '${{ steps.decide.outputs.admitted }}',
            reason: '${{ steps.decide.outputs.reason }}',
        })
    ) {
        throw new Error('approval admission must export its decision and reason');
    }
}

/**
 * The approval-gated boundary of the required check. GitHub counts a `skipped` conclusion as
 * satisfying a required check and prefers the newest run of its name, so: only a labeled
 * `pull_request` run of `health-gates.yml` may mint `Gate`; `Gate` always runs and fails unless
 * the trusted admission admitted the event's exact head; every other job waits for that admission;
 * and the cheap per-push workflow, like every other file, mints no `Gate`.
 */
export function assertApprovalGatedRequiredCheck(workflows: Readonly<Record<string, unknown>>): void {
    const health = asWorkflowRecord(workflows['health-gates.yml'], 'health-gates.yml');
    if (!sameValue(health.on, HEALTH_GATES_EVENTS)) {
        throw new Error(
            'health-gates.yml must answer to labeled pull_request events alone, or a skipped Gate can satisfy the required check'
        );
    }
    const jobs = workflowJobs(health, 'health-gates.yml');
    assertGateCannotSkip(asWorkflowRecord(jobs.gate, 'gate'));
    assertTrustedAdmission(asWorkflowRecord(jobs.admission, 'admission'));
    const scope = asWorkflowRecord(jobs.scope, 'scope');
    if (scope.needs !== 'admission' || scope.if !== ADMITTED_CONDITION) {
        throw new Error('the heavy checks must start only after approval admission admits the head');
    }
    for (const [jobId, job] of Object.entries(jobs)) {
        if (jobId === 'admission' || jobId === 'gate' || jobId === 'scope') {
            continue;
        }
        const needs = asWorkflowRecord(job, jobId).needs;
        if (needs !== 'scope' && !(Array.isArray(needs) && needs.includes('scope'))) {
            throw new Error(`health-gates.yml job ${jobId} must wait for approval admission through scope`);
        }
    }
    const checks = asWorkflowRecord(workflows['pr-checks.yml'], 'pr-checks.yml');
    if (!sameValue(checks.on, PR_CHECKS_EVENTS)) {
        throw new Error('pr-checks.yml must answer to pull-request pushes alone');
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
