import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createJournal, recordOf, requiredText, writeReceipt } from './journal.ts';
import { linuxIdentity } from './linuxProcessIdentity.ts';
import { runPhase } from './processPhase.ts';

// This is a one-time deadline cleanup of the synthetic control's owned subtree,
// including forks from non-leader threads and Chromium's detached process groups.
function cleanDetachedControls(root: number, record: ReturnType<typeof createJournal>): void {
    if (process.platform !== 'linux') {
        record('native-cleanup-unknown', 'Linux detached group census unavailable');
        return;
    }
    const queue = [root];
    const seen = new Set<number>();
    const groups = new Set<number>();
    while (queue.length > 0 && seen.size < 2048) {
        const pid = queue.shift();
        if (pid === undefined || seen.has(pid)) {
            continue;
        }
        seen.add(pid);
        try {
            const identity = linuxIdentity(pid, root);
            if (!identity.owned || identity.namespace !== identity.observerNamespace) {
                throw new Error('Cleanup ownership unproved');
            }
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const group = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
            if (group === pid && pid !== root) {
                groups.add(pid);
            }
            for (const task of readdirSync(`/proc/${pid}/task`)) {
                const children = readFileSync(`/proc/${pid}/task/${task}/children`, 'utf8');
                for (const child of children.trim().split(/\s+/).filter(Boolean)) {
                    queue.push(Number(child));
                }
            }
        } catch (error) {
            record('native-cleanup-census-unknown', { pid, reason: String(error) });
        }
    }
    if (queue.length > 0) {
        record('native-cleanup-census-unknown', 'Control subtree exceeded2048 entries');
    }
    for (const group of groups) {
        try {
            const identity = linuxIdentity(group, root);
            if (!identity.owned || identity.namespace !== identity.observerNamespace) {
                throw new Error('Detached control group no longer owned');
            }
            process.kill(-group, 'SIGKILL');
            record('native-detached-control-group-killed', { identity, signal: 'SIGKILL' });
        } catch (error) {
            record('native-detached-cleanup-unknown', { group, reason: String(error) });
        }
    }
}

export async function superviseNativeControl(
    root: string,
    args: string[],
    output: string,
    timeoutMs = 90_000
): Promise<string> {
    const phase = resolve(output, 'native-preflight-supervisor');
    const record = createJournal(resolve(phase, 'cleanup.jsonl'));
    const code = await runPhase(
        root,
        args,
        { ...process.env, RELOAD_DIAGNOSTIC_PHASE: 'native-preflight' },
        phase,
        timeoutMs,
        (pid) => cleanDetachedControls(pid, record)
    );
    const exit = recordOf(
        JSON.parse(readFileSync(resolve(phase, 'exit.json'), 'utf8')) as unknown,
        'native control exit'
    );
    try {
        if (code !== 0) {
            throw new Error(`Synthetic control exited with ${code}`);
        }
        const qualified = recordOf(
            JSON.parse(readFileSync(resolve(output, 'native-preflight/qualified.json'), 'utf8')) as unknown,
            'native preflight'
        );
        if (qualified.actualLinuxControls !== true || qualified.pinnedBrowserScriptMapping !== true) {
            throw new Error('Actual native control proof missing');
        }
        const wrapper = requiredText(qualified.wrapper, 'qualified native browser wrapper');
        writeReceipt(resolve(phase, 'qualification.json'), {
            observed: true,
            childCode: code,
            exit,
            timeoutMs,
            appExecutionAdmitted: false,
        });
        return wrapper;
    } catch (error) {
        writeReceipt(resolve(phase, 'qualification.json'), {
            observed: false,
            childCode: code,
            exit,
            timeoutMs,
            appExecutionAdmitted: false,
            unknown: String(error),
        });
        throw new Error(
            'Native preflight control failed or exceeded its deadline; original execution was not admitted',
            { cause: error }
        );
    }
}
