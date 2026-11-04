#!/usr/bin/env node
import { fail } from './prContract.ts';

export const USAGE = 'usage: pnpm review:resolve <pr-number> --thread <thread-node-id> --head <full-sha>';
export const RESOLUTION_RETIRED_MESSAGE =
    'review:resolve is retired; record the repair with review:repair and resolve it with review:confirm';

const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;

export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };

export function parseResolveReviewThreadArgs(args: string[]): ResolveReviewThreadArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [number, threadFlag, threadId, headFlag, head] = args;
    if (
        args.length !== 5 ||
        threadFlag !== '--thread' ||
        headFlag !== '--head' ||
        number === undefined ||
        threadId === undefined ||
        head === undefined ||
        !/^[1-9][0-9]*$/.test(number) ||
        !/^\S+$/.test(threadId) ||
        !FORTY_HEX_PATTERN.test(head)
    ) {
        fail(USAGE);
    }
    const parsed = Number(number);
    if (!Number.isSafeInteger(parsed)) {
        fail(USAGE);
    }
    return { number: parsed, threadId, head, help: false };
}

/**
 * PR #4411 introduced reviewer confirmation without defining provable legacy write eligibility.
 * Keep the old command discoverable, but require the repair/confirm route for every resolution.
 * Historical records remain readable through their owning reconstruction and repair contracts.
 */
export async function runResolveReviewThreadCli(args: string[]): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${USAGE.slice('usage: '.length)}`);
        console.log(RESOLUTION_RETIRED_MESSAGE);
        return 0;
    }
    return fail(RESOLUTION_RETIRED_MESSAGE);
}
