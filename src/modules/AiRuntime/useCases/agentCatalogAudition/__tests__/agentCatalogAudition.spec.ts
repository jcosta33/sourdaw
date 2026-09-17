import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { applyAgentAuditionCandidate } from '../applyAgentAuditionCandidate';
import { auditionAgentCatalogCandidate } from '../auditionAgentCatalogCandidate';

const mocks = vi.hoisted(() => ({
    tempoBpm: 120,
    trackStore: { value: { tracks: [] as Array<{ id: string; kind: string }> } },
    resolveAgentCatalogCandidate: vi.fn(),
    decodeAudioFileBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    analyzeAgentAuditionBuffer: vi.fn(),
    getAssetTransfer: vi.fn(),
    executeAppActionBatch: vi.fn(),
    stageLocalAsset: vi.fn(),
    releaseStagedAsset: vi.fn(),
    promoteStagedAsset: vi.fn(),
}));

// Every barrel the workflow reads is replaced by name rather than spread, so a
// switch from the isolated decode to the caching one resolves to an export this
// factory does not define and fails the run instead of silently caching.
vi.mock('#/modules/SampleLibrary/useCases', () => ({
    resolveAgentCatalogCandidate: mocks.resolveAgentCatalogCandidate,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFileBuffer: mocks.decodeAudioFileBuffer,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
}));
vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    analyzeAgentAuditionBuffer: mocks.analyzeAgentAuditionBuffer,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: mocks.getAssetTransfer }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppActionBatch: mocks.executeAppActionBatch }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { tempo: mocks.tempoBpm } },
    DEFAULT_TEMPO_BPM: mocks.tempoBpm,
}));

const TEMPO_BPM = mocks.tempoBpm;
const SECONDS_PER_MINUTE = 60;
const SAMPLE_RATE = 48_000;
const CANDIDATE_ID = 'sample-42';
const AUDIO_TRACK_ID = 'track-7';
const BUS_TRACK_ID = 'bus-2';
const MIDI_TRACK_ID = 'midi-3';
const ABSENT_TRACK_ID = 'track-absent';
const START_BEAT = 8;
const STAGED_HASH = 'asset-hash';
const STAGED_LEASE = 'lease-1';
const CACHED_BUFFER_ID = 'audio-cached';

const CANDIDATE = {
    id: CANDIDATE_ID,
    displayName: 'Brushed Snare',
    provenance: {
        origin: 'connected-library',
        libraryRootId: 'root-1',
        libraryRootName: 'Drums',
        provider: 'desktop',
        relativePath: 'snares/brushed.wav',
        indexStatus: 'indexed',
    },
    licensing: { source: 'user-library', rightsHolder: 'user', terms: 'as-licensed-to-the-user' },
};

const ANALYSIS = {
    status: 'measured',
    schemaVersion: 1,
    subject: { contentAddress: '', candidateId: CANDIDATE_ID, sampleRate: SAMPLE_RATE },
    measurements: {},
    comparison: null,
    warnings: [],
};

/** One second of a steady level, so two fixtures differ in samples and therefore in address. */
function audioBuffer(amplitude: number, seconds = 1): AudioBuffer {
    const length = Math.round(SAMPLE_RATE * seconds);
    const samples = new Float32Array(length).fill(amplitude);
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 1,
        duration: length / SAMPLE_RATE,
        getChannelData: () => samples,
    } as unknown as AudioBuffer;
}

const AUDITED_BUFFER = audioBuffer(0.25);
const REPLACED_BUFFER = audioBuffer(0.5);
const EMPTY_BUFFER = audioBuffer(0, 0);
const CANDIDATE_FILE = new File([new Uint8Array([1, 2, 3])], 'brushed.wav');

function resolvesCandidate(): void {
    mocks.resolveAgentCatalogCandidate.mockResolvedValue({
        status: 'resolved',
        candidate: CANDIDATE,
        file: CANDIDATE_FILE,
    });
}

function armWorkflowMocks(): void {
    vi.clearAllMocks();
    mocks.trackStore.value = {
        tracks: [
            { id: AUDIO_TRACK_ID, kind: 'audio' },
            { id: BUS_TRACK_ID, kind: 'bus' },
            { id: MIDI_TRACK_ID, kind: 'midi' },
        ],
    };
    mocks.analyzeAgentAuditionBuffer.mockImplementation(({ subject }: { subject: { contentAddress: string } }) => ({
        ...ANALYSIS,
        subject: { ...ANALYSIS.subject, contentAddress: subject.contentAddress },
    }));
    mocks.cacheAudioBuffer.mockReturnValue(CACHED_BUFFER_ID);
    mocks.stageLocalAsset.mockResolvedValue({ hash: STAGED_HASH, leaseId: STAGED_LEASE });
    mocks.getAssetTransfer.mockReturnValue({
        stageLocalAsset: mocks.stageLocalAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
        promoteStagedAsset: mocks.promoteStagedAsset,
    });
    mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
}

type AuditionResult = Awaited<ReturnType<typeof auditionAgentCatalogCandidate>>;
type AuditionReceipt = Extract<AuditionResult, { status: 'auditioned' }>['receipt'];

async function auditioned(): Promise<AuditionReceipt> {
    resolvesCandidate();
    mocks.decodeAudioFileBuffer.mockResolvedValue(AUDITED_BUFFER);
    const result = await auditionAgentCatalogCandidate({ candidateId: CANDIDATE_ID });
    if (result.status !== 'auditioned') {
        throw new Error(`Expected the fixture audition to succeed, got ${result.reason}`);
    }
    return result.receipt;
}

function dispatchedAddClip(): { type: string; payload: Record<string, unknown> } {
    const call = mocks.executeAppActionBatch.mock.calls[0];
    if (!call) {
        throw new Error('Expected the placement to dispatch one action batch');
    }
    const actions = call[0] as Array<{ type: string; payload: Record<string, unknown> }>;
    const action = actions[0];
    if (!action) {
        throw new Error('Expected the dispatched batch to carry one action');
    }
    return action;
}

function dispatchedOptions(): { groupLabel?: string; source?: string; requireCompensation?: boolean } {
    const call = mocks.executeAppActionBatch.mock.calls[0];
    if (!call) {
        throw new Error('Expected the placement to dispatch one action batch');
    }
    return call[1] as { groupLabel?: string; source?: string; requireCompensation?: boolean };
}

describe('agent catalog audition', () => {
    beforeEach(armWorkflowMocks);

    it('refuses a candidate id the catalog cannot name, and decodes nothing', async () => {
        mocks.resolveAgentCatalogCandidate.mockResolvedValue({ status: 'rejected', reason: 'unknown-catalog-id' });

        const result = await auditionAgentCatalogCandidate({ candidateId: 'absent' });

        expect(result).toEqual({ status: 'rejected', reason: 'unknown-catalog-id' });
        expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
    });

    it('refuses a candidate whose file the library cannot open', async () => {
        mocks.resolveAgentCatalogCandidate.mockResolvedValue({ status: 'rejected', reason: 'file-unavailable' });

        const result = await auditionAgentCatalogCandidate({ candidateId: CANDIDATE_ID });

        expect(result).toEqual({ status: 'rejected', reason: 'file-unavailable' });
    });

    it('refuses audio it cannot decode', async () => {
        resolvesCandidate();
        mocks.decodeAudioFileBuffer.mockRejectedValue(new Error('unsupported codec'));

        const result = await auditionAgentCatalogCandidate({ candidateId: CANDIDATE_ID });

        expect(result).toEqual({ status: 'rejected', reason: 'undecodable-audio' });
    });

    it('measures the decoded buffer under its own content address and the candidate id', async () => {
        const receipt = await auditioned();

        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(CANDIDATE_FILE);
        expect(receipt.contentAddress).toBe(await getAudioBufferContentAddress(AUDITED_BUFFER));
        expect(receipt.candidate).toEqual(CANDIDATE);
        expect(mocks.analyzeAgentAuditionBuffer).toHaveBeenCalledWith({
            buffer: AUDITED_BUFFER,
            subject: { contentAddress: receipt.contentAddress, candidateId: CANDIDATE_ID },
            baseline: undefined,
        });
    });

    it('compares a new audition against an earlier receipt for the same candidate', async () => {
        const baseline = await auditioned();
        mocks.analyzeAgentAuditionBuffer.mockClear();
        mocks.decodeAudioFileBuffer.mockResolvedValue(REPLACED_BUFFER);

        await auditionAgentCatalogCandidate({ candidateId: CANDIDATE_ID, baseline });

        expect(mocks.analyzeAgentAuditionBuffer).toHaveBeenCalledWith(
            expect.objectContaining({ baseline: baseline.analysis })
        );
    });

    it('writes no project state and places no buffer in the shared cache', async () => {
        await auditioned();

        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });
});

describe('agent audition placement', () => {
    beforeEach(armWorkflowMocks);

    it('refuses a destination that is not an existing audio track, before reading any audio', async () => {
        const receipt = await auditioned();

        for (const trackId of [BUS_TRACK_ID, MIDI_TRACK_ID, ABSENT_TRACK_ID]) {
            mocks.decodeAudioFileBuffer.mockClear();

            const result = await applyAgentAuditionCandidate({ receipt, trackId, startBeat: START_BEAT });

            expect(result).toEqual({ status: 'rejected', reason: 'track-not-audio' });
            expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
        }
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('reaches the project through exactly one versioned addClip command', async () => {
        const receipt = await auditioned();

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result.status).toBe('applied');
        expect(mocks.executeAppActionBatch).toHaveBeenCalledTimes(1);
        expect(dispatchedAddClip()).toEqual({
            type: 'addClip',
            payload: {
                trackId: AUDIO_TRACK_ID,
                startBeat: START_BEAT,
                endBeat: START_BEAT + (AUDITED_BUFFER.duration / SECONDS_PER_MINUTE) * TEMPO_BPM,
                name: CANDIDATE.displayName,
                type: 'audio',
                audioBufferId: CACHED_BUFFER_ID,
                assetHash: STAGED_HASH,
            },
        });
        const options = dispatchedOptions();
        expect(options.source).toBe('ai');
        expect(options.requireCompensation).toBe(true);
        expect(options.groupLabel).toContain(CANDIDATE.displayName);
    });

    it('refuses audio whose content address is not the audited one, and writes nothing', async () => {
        const receipt = await auditioned();
        mocks.decodeAudioFileBuffer.mockResolvedValue(REPLACED_BUFFER);

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({ status: 'rejected', reason: 'content-address-mismatch' });
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
    });

    it('refuses audio carrying no frames, and writes nothing', async () => {
        const receipt = await auditioned();
        mocks.decodeAudioFileBuffer.mockResolvedValue(EMPTY_BUFFER);

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({ status: 'rejected', reason: 'empty-audio' });
        expect(mocks.stageLocalAsset).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('promotes the staged asset once the command commits', async () => {
        const receipt = await auditioned();

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toMatchObject({ status: 'applied', assetFinalized: true });
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith(STAGED_LEASE);
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
    });

    it('keeps the media and promotes the asset when the commit is ambiguous', async () => {
        const receipt = await auditioned();
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'ambiguous',
            actions: [],
            reason: 'the commit may have landed',
        });

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({
            status: 'ambiguous',
            detail: 'the commit may have landed',
            audioBufferId: CACHED_BUFFER_ID,
            contentAddress: receipt.contentAddress,
            assetFinalized: true,
        });
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith(STAGED_LEASE);
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('releases the staged asset and evicts the cached buffer when the project refuses the write', async () => {
        const receipt = await auditioned();
        mocks.executeAppActionBatch.mockResolvedValue({
            status: 'rejected',
            reason: 'project repair required',
            actions: [],
        });

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'project-write-refused',
            detail: 'project repair required',
        });
        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith(STAGED_LEASE);
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith(CACHED_BUFFER_ID);
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('releases the staged asset and evicts the cached buffer when the dispatch throws', async () => {
        const receipt = await auditioned();
        mocks.executeAppActionBatch.mockRejectedValue(new Error('storage transaction aborted'));

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'project-write-refused',
            detail: 'storage transaction aborted',
        });
        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith(STAGED_LEASE);
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledWith(CACHED_BUFFER_ID);
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('refuses to place a candidate the library no longer holds', async () => {
        const receipt = await auditioned();
        mocks.resolveAgentCatalogCandidate.mockResolvedValue({ status: 'rejected', reason: 'file-unavailable' });

        const result = await applyAgentAuditionCandidate({ receipt, trackId: AUDIO_TRACK_ID, startBeat: START_BEAT });

        expect(result).toEqual({ status: 'rejected', reason: 'file-unavailable' });
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });
});
