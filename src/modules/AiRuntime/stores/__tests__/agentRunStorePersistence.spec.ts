import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_RUN_RETENTION_POLICY } from '../../models/AgentRetentionPolicy';
import { type AgentRun } from '../../models/AgentRun';
import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { agentRunStore, readAgentRunState } from '../agentRunStore';

vi.mock('superjson', async (importOriginal) => {
    const actual = await importOriginal<typeof import('superjson')>();
    return { ...actual, stringify: vi.fn(actual.stringify) };
});

const LEGACY_KEY = 'sourdaw-agent-runs';
const STORAGE_PREFIX = 'sourdaw-agent-runs';
const SEEDED_AT = 1_800_000_000_000;

function seedCompletedRuns(count: number): void {
    for (let index = 0; index < count; index++) {
        const runId = `seed-run-${String(index)}`;
        const at = SEEDED_AT + index;
        agentRunLifecycle.create({
            runId,
            request: `Seeded request ${String(index)} with enough text to resemble a real prompt.`,
            mode: 'plan',
            createdRevision: 'revision-1',
            createdAt: at,
        });
        agentRunLifecycle.transitionPhase({ runId, phase: 'planning', transitionedAt: at });
        agentRunLifecycle.transitionPhase({ runId, phase: 'completed', transitionedAt: at });
    }
}

function startTargetRun(): void {
    const at = SEEDED_AT + 10_000;
    agentRunLifecycle.create({
        runId: 'target-run',
        request: 'The run this update changes.',
        mode: 'plan',
        createdRevision: 'revision-1',
        createdAt: at,
    });
    agentRunLifecycle.transitionPhase({ runId: 'target-run', phase: 'planning', transitionedAt: at });
}

/** Run ids of every AgentRun-shaped object reachable from `value`. */
function collectRunIds(value: unknown, into: Set<string>): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectRunIds(item, into);
        }
        return into;
    }
    if (typeof value !== 'object' || value === null) {
        return into;
    }
    if ('runId' in value && 'request' in value && typeof value.runId === 'string') {
        into.add(value.runId);
    }
    for (const child of Object.values(value)) {
        collectRunIds(child, into);
    }
    return into;
}

type UpdateWork = {
    serializedRunIds: string[];
    clonedRunIds: string[];
    storedBytes: number;
};

/** Seeds `retainedRuns` other runs, then measures one update of the target run at the real boundaries. */
function measureOneUpdate(retainedRuns: number): UpdateWork {
    agentRunLifecycle.clear();
    seedCompletedRuns(retainedRuns);
    startTargetRun();

    const serialized = new Set<string>();
    const cloned = new Set<string>();
    let storedBytes = 0;
    vi.mocked(stringify).mockClear();
    const clone = vi.spyOn(globalThis, 'structuredClone');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
        agentRunLifecycle.transitionPhase({
            runId: 'target-run',
            phase: 'completed',
            transitionedAt: SEEDED_AT + 20_000,
        });
        for (const [value] of vi.mocked(stringify).mock.calls) {
            collectRunIds(value, serialized);
        }
        for (const [value] of clone.mock.calls) {
            collectRunIds(value, cloned);
        }
        for (const [key, value] of setItem.mock.calls) {
            if (key.startsWith(STORAGE_PREFIX)) {
                storedBytes += value.length;
            }
        }
    } finally {
        clone.mockRestore();
        setItem.mockRestore();
    }
    return {
        serializedRunIds: [...serialized].toSorted(),
        clonedRunIds: [...cloned].toSorted(),
        storedBytes,
    };
}

function storedAgentRunKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) {
            keys.push(key);
        }
    }
    return keys.toSorted();
}

async function hydrateFreshStore(): Promise<typeof agentRunStore> {
    vi.resetModules();
    const fresh = await import('../agentRunStore');
    return fresh.agentRunStore;
}

describe('agent run persistence', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('serializes, clones and stores only the changed run, however many runs are retained', () => {
        const retainedMaximum = AGENT_RUN_RETENTION_POLICY.maxCount - 1;
        const alone = measureOneUpdate(0);
        const atBound = measureOneUpdate(retainedMaximum);

        expect(alone.serializedRunIds).toEqual(['target-run']);
        expect(atBound.serializedRunIds).toEqual(['target-run']);
        expect(atBound.clonedRunIds).toEqual(alone.clonedRunIds);
        expect(atBound.clonedRunIds.every((runId) => runId === 'target-run')).toBe(true);
        // The stored index names each retained run by key, a few dozen bytes per run; a
        // re-serialized run costs far more than that.
        const bytesPerRetainedRun = (atBound.storedBytes - alone.storedBytes) / retainedMaximum;
        expect(bytesPerRetainedRun).toBeLessThan(128);
    });

    it('keeps every unchanged run object when another run is updated', () => {
        seedCompletedRuns(3);
        startTargetRun();
        const before = agentRunStore.value?.runs ?? [];

        agentRunLifecycle.transitionPhase({ runId: 'target-run', phase: 'completed', transitionedAt: SEEDED_AT + 1 });

        const after = agentRunStore.value?.runs ?? [];
        expect(after.map((run) => run.runId)).toEqual(before.map((run) => run.runId));
        expect(after.map((run, index) => run === before[index])).toEqual(
            before.map((run) => run.runId !== 'target-run')
        );
        expect(after.find((run) => run.runId === 'target-run')?.phase).toBe('completed');
    });

    it('restores exactly the returned state when a fresh store hydrates after an update returns', async () => {
        seedCompletedRuns(4);
        startTargetRun();

        const returned = agentRunLifecycle.transitionPhase({
            runId: 'target-run',
            phase: 'completed',
            transitionedAt: SEEDED_AT + 5,
        });
        const inMemory = readAgentRunState();

        const freshStore = await hydrateFreshStore();
        expect(freshStore.value).toEqual(inMemory);
        expect(freshStore.value?.runs.find((run) => run.runId === 'target-run')).toEqual(returned);
    });

    it('loads state persisted in the single-key format and replaces it on the next write', async () => {
        seedCompletedRuns(2);
        startTargetRun();
        const legacyState = readAgentRunState();
        for (const key of storedAgentRunKeys()) {
            window.localStorage.removeItem(key);
        }
        window.localStorage.setItem(LEGACY_KEY, stringify(legacyState));

        const freshStore = await hydrateFreshStore();
        expect(freshStore.value).toEqual(legacyState);
        expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();

        const { agentRunLifecycle: freshLifecycle } = await import('../../useCases/agentRunLifecycle');
        const returned = freshLifecycle.transitionPhase({
            runId: 'target-run',
            phase: 'completed',
            transitionedAt: SEEDED_AT + 9,
        });
        const rehydrated = await hydrateFreshStore();
        expect(rehydrated.value?.runs.map((run) => run.runId)).toEqual(legacyState.runs.map((run) => run.runId));
        expect(rehydrated.value?.runs.find((run) => run.runId === 'target-run')).toEqual(returned);
    });

    it('boots with the other runs when the index names a run whose key is missing, and keeps saving', async () => {
        seedCompletedRuns(3);
        window.localStorage.removeItem(`${STORAGE_PREFIX}:run:seed-run-1`);

        const freshStore = await hydrateFreshStore();
        expect(freshStore.value?.runs.map((run) => run.runId)).toEqual(['seed-run-0', 'seed-run-2']);
        const { agentRunLifecycle: freshLifecycle } = await import('../../useCases/agentRunLifecycle');
        freshLifecycle.create({ runId: 'after-missing-run', request: 'Saved.', mode: 'plan', createdRevision: 'r1' });

        const rehydrated = await hydrateFreshStore();
        expect(rehydrated.value?.runs.map((run) => run.runId)).toEqual([
            'seed-run-0',
            'seed-run-2',
            'after-missing-run',
        ]);
    });

    it('clears run history even after a read another writer interrupted', async () => {
        seedCompletedRuns(2);
        const indexKey = `${STORAGE_PREFIX}:index`;
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        let interrupted = false;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
            if (!interrupted && key.startsWith(`${STORAGE_PREFIX}:run:`)) {
                interrupted = true;
                setItem.call(this, indexKey, `${getItem.call(this, indexKey) ?? ''} `);
            }
            return getItem.call(this, key);
        });
        const freshStore = await hydrateFreshStore();
        vi.restoreAllMocks();
        expect(freshStore.value?.runs ?? []).toEqual([]);
        const { agentRunLifecycle: freshLifecycle } = await import('../../useCases/agentRunLifecycle');

        freshLifecycle.clear();

        expect(storedAgentRunKeys()).toEqual([indexKey]);
        freshLifecycle.create({ runId: 'after-clear', request: 'Saved.', mode: 'plan', createdRevision: 'r1' });
        const rehydrated = await hydrateFreshStore();
        expect(rehydrated.value?.runs.map((run) => run.runId)).toEqual(['after-clear']);
    });

    it('evicts the oldest uncommitted terminal run at the count bound and leaves no stored copy of it', async () => {
        seedCompletedRuns(AGENT_RUN_RETENTION_POLICY.maxCount);
        const keysAtBound = storedAgentRunKeys();

        startTargetRun();

        const runIds = (agentRunStore.value?.runs ?? []).map((run: AgentRun) => run.runId);
        expect(runIds).toHaveLength(AGENT_RUN_RETENTION_POLICY.maxCount);
        expect(runIds).not.toContain('seed-run-0');
        expect(runIds).toContain('seed-run-1');
        expect(runIds.at(-1)).toBe('target-run');
        expect(storedAgentRunKeys()).toHaveLength(keysAtBound.length);

        const freshStore = await hydrateFreshStore();
        expect(freshStore.value?.runs.map((run) => run.runId)).toEqual(runIds);
    });
});
