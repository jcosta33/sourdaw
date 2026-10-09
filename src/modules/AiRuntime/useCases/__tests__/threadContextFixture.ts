import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { THREAD_CONTEXT_MAX_TURNS, type ThreadContext } from '../../models/ThreadContext';

import { fixtureUuid } from './planningProjectFixture';

const REQUEST_LENGTH = 512;

/** The `index`th earlier request, numbered so a reader can tell which survived, at the per-request bound. */
export function threadRequest(index: number): string {
    const head = `request ${String(index).padStart(2, '0')}: make the low end tighter and pull the vocal forward`;
    return `${head}${' and keep the snare where it is'.repeat(REQUEST_LENGTH)}`.slice(0, REQUEST_LENGTH);
}

function gainCommand(prefix: string, index: number) {
    const trackId = `track-${fixtureUuid(`${prefix}:${String(index)}`)}`;
    return {
        name: 'setTrackGain',
        label: `Set Track ${String(index + 1)} gain to -3.5 dB`,
        arguments: { trackId, gainDb: -3.5, expectedGain: 0.794_328_234_724_281_4 },
    };
}

/**
 * A thread at every bound at once: a full window of requests at the request bound, a pending
 * proposal and a commit at the per-batch command budget, the commit's receipts and a measured
 * preview with deltas on every target. Every id is shaped as production mints it.
 */
export function createFullThreadContext(): ThreadContext {
    const committedRunId = `agent-run-${fixtureUuid('thread:committed-run')}`;
    return {
        requests: Array.from({ length: THREAD_CONTEXT_MAX_TURNS }, (_, index) => threadRequest(index + 1)),
        pendingProposal: {
            runId: `agent-run-${fixtureUuid('thread:pending-run')}`,
            commands: Array.from({ length: MAX_LLM_ACTIONS_PER_BATCH }, (_, index) => gainCommand('pending', index)),
        },
        lastCommit: {
            runId: committedRunId,
            receiptIds: Array.from(
                { length: 8 },
                (_, index) => `command:${committedRunId}:${fixtureUuid(`thread:batch:${String(index)}`)}`
            ),
            reverted: false,
            commands: Array.from({ length: MAX_LLM_ACTIONS_PER_BATCH }, (_, index) => gainCommand('committed', index)),
            measuredDeltas: Array.from({ length: 16 }, (_, index) => ({
                targetId: `track-${fixtureUuid(`committed:${String(index)}`)}`,
                metric: index % 2 === 0 ? 'integratedLoudness' : 'truePeak',
                delta: -1.25,
                unit: index % 2 === 0 ? 'LUFS' : 'dBTP',
            })),
        },
    };
}
