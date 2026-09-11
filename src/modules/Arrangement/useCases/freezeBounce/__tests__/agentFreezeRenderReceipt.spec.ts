import { beforeEach, describe, expect, it, vi } from 'vitest';

type RevisionMatches =
    typeof import('#/modules/CrdtDocument/useCases').projectRevisionMatchesLiveIgnoringCommandCheckpoint;

const mocks = vi.hoisted(() => ({
    revisionMatches: vi.fn<RevisionMatches>(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: mocks.revisionMatches,
}));

import { type AgentRenderReceipt, type AgentWorkOwnerIdentity } from '#/utils/agentRenderReceipt';

import { admitAgentRenderReceipt, type AgentRenderArtifactSnapshot } from '../admitAgentRenderReceipt';

type RenderedReceipt = Extract<AgentRenderReceipt, { phase: 'rendered' }>;

const OWNER: AgentWorkOwnerIdentity = {
    runId: 'run-1',
    workId: 'work-1',
    leaseId: 'lease-1',
    cancellationGeneration: 0,
};

const PROVENANCE = {
    jobId: 'job-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 8,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0,
    sourceRevision: 'revision-1',
};

function createRenderedReceipt(overrides: Partial<Omit<RenderedReceipt, 'phase'>> = {}): RenderedReceipt {
    return {
        phase: 'rendered',
        owner: OWNER,
        provenance: PROVENANCE,
        contentAddress: 'content-address-1',
        frameCount: 4,
        channelCount: 2,
        renderedAt: 10,
        ...overrides,
    };
}

function createMatchingArtifact(
    overrides: Partial<
        Pick<AgentRenderArtifactSnapshot, 'contentAddress' | 'sourceRevision' | 'frameCount' | 'channelCount'>
    > = {}
): AgentRenderArtifactSnapshot {
    return {
        ...PROVENANCE,
        frameCount: 4,
        channelCount: 2,
        contentAddress: 'content-address-1',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.revisionMatches.mockReturnValue(true);
});

describe('admitAgentRenderReceipt', () => {
    it('admits a bounceSelection mutation as the literal range app action', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'bounceSelection', trackId: 'track-1', startBeat: 8, endBeat: 16 },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({
            status: 'admitted',
            action: { type: 'bounceSelection', payload: { trackId: 'track-1', startBeat: 8, endBeat: 16 } },
        });
    });

    it('admits a freezeTrack mutation as the literal trackId-only app action', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({
            status: 'admitted',
            action: { type: 'freezeTrack', payload: { trackId: 'track-1' } },
        });
    });

    it('rejects a started-phase receipt as receipt-not-rendered', () => {
        const result = admitAgentRenderReceipt({
            receipt: { phase: 'started', owner: OWNER, provenance: PROVENANCE },
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'receipt-not-rendered' });
    });

    it('rejects a receipt whose owner cancellation generation differs from the live owner as lease-mismatch', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt({ owner: { ...OWNER, cancellationGeneration: 1 } }),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'lease-mismatch' });
    });

    it('admits a receipt whose owner workId differs from the live owner (binding is run identity plus cancellation generation)', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt({ owner: { ...OWNER, workId: 'other-work', leaseId: 'other-lease' } }),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact()],
        });

        expect(result.status).toBe('admitted');
    });

    it('rejects when the live project revision no longer matches the receipt provenance as stale-revision', () => {
        mocks.revisionMatches.mockReturnValue(false);

        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'stale-revision' });
    });

    it('rejects when no retained artifact matches the receipt job id as artifact-missing', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'artifact-missing' });
    });

    it('rejects when the matching artifact content address differs as content-address-mismatch', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact({ contentAddress: 'content-address-2' })],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'content-address-mismatch' });
    });

    it('rejects when the matching artifact source revision differs as content-address-mismatch', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [createMatchingArtifact({ sourceRevision: 'revision-2' })],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'content-address-mismatch' });
    });

    it('rejects a range mutation whose beats are off by one from the provenance as range-mismatch', () => {
        const result = admitAgentRenderReceipt({
            receipt: createRenderedReceipt(),
            liveOwner: OWNER,
            mutation: { type: 'bounceSelection', trackId: 'track-1', startBeat: 8, endBeat: 17 },
            artifacts: [createMatchingArtifact()],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'range-mismatch' });
    });

    it('never invokes the revision checker or consults the artifact list when the phase check already fails', () => {
        mocks.revisionMatches.mockReturnValue(false);

        const result = admitAgentRenderReceipt({
            receipt: { phase: 'started', owner: OWNER, provenance: PROVENANCE },
            liveOwner: OWNER,
            mutation: { type: 'freezeTrack', trackId: 'track-1' },
            artifacts: [],
        });

        // A stale revision or an empty artifact list would each produce a different rejection
        // reason if the phase check did not short-circuit first; receiving `receipt-not-rendered`
        // pins that the phase check runs before either.
        expect(result).toEqual({ status: 'rejected', reason: 'receipt-not-rendered' });
        expect(mocks.revisionMatches).not.toHaveBeenCalled();
    });
});
