import { openSync, closeSync, writeFileSync } from 'node:fs';

import { recordOf, requiredText } from './journal.ts';

export function admitExecutionParent(event: unknown, rawCommit: string, expectedParent: string | undefined): void {
    const before = recordOf(event, 'event').before;
    // Raw commit metadata retains parents even at actions/checkout's shallow boundary.
    const header = rawCommit.split('\n\n')[0] ?? '';
    const firstParent = header
        .split('\n')
        .find((line) => line.startsWith('parent '))
        ?.slice(7);
    if (
        !expectedParent ||
        !/^[0-9a-f]{40}$/.test(expectedParent) ||
        before !== expectedParent ||
        firstParent !== expectedParent
    ) {
        throw new Error(
            'Native observation is frozen or event.before/actual first parent differs from the published preparation head'
        );
    }
}

export function admitHostedAttempt(
    event: unknown,
    env: NodeJS.ProcessEnv,
    platform: string,
    harnessHead: string
): void {
    const payload = recordOf(event, 'pull-request event');
    const pull = recordOf(payload.pull_request, 'pull_request');
    const head = recordOf(pull.head, 'pull_request.head');
    if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'pull_request') {
        throw new Error('Execution requires the hosted Linux pull-request diagnostic');
    }
    if (payload.action !== 'synchronize' || pull.number !== 5847 || env.GITHUB_RUN_ATTEMPT !== '1') {
        throw new Error('Only PR5847 first synchronize attempt may execute; no rerun or other pull request');
    }
    if (head.sha !== harnessHead || !/^[0-9a-f]{40}$/.test(harnessHead)) {
        throw new Error('Diagnostic harness head does not match the synchronize event');
    }
    if (!/^[1-9][0-9]*$/.test(requiredText(env.GITHUB_RUN_ID, 'run id'))) {
        throw new Error('Invalid diagnostic run id');
    }
}

export function claimExecution(path: string, receipt: unknown): void {
    // Exclusive creation prevents a second child in the same job, including after a failed first child.
    const descriptor = openSync(path, 'wx');
    try {
        writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`);
    } finally {
        closeSync(descriptor);
    }
}
