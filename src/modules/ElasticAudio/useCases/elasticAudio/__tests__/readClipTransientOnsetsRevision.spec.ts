import { change, clone, getHeads, merge, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { readClipTransientOnsets } from '../readClipTransientOnsets';

const mocks = vi.hoisted(() => ({ worker: vi.fn(), cache: vi.fn() }));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        subscribe: () => () => {},
        value: {
            tracks: [
                {
                    id: 'track-1',
                    devices: [],
                    clips: [{ id: 'clip-1', type: 'audio', audioBufferId: 'buffer-1' }],
                    alternatives: [],
                    activeAlternativeId: 'active',
                },
            ],
        },
    },
}));
vi.mock('#/modules/Project/stores', () => ({ getSettledProjectId: () => 'project-1' }));
vi.mock('#/modules/AudioEngine/stores', () => ({ audioBufferCache: { get: mocks.cache } }));
vi.mock('../../../repositories/transientOnsetWorkerClient', () => ({ runTransientOnsetWorker: mocks.worker }));

describe('transient source revision authority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('transient revision test');
        createCrdtDoc('root');
        mocks.cache.mockReturnValue({
            length: 4_096,
            sampleRate: 16_000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(4_096),
        });
    });
    afterEach(() => resetCrdtProjectAuthority('transient revision cleanup'));

    it.each([false, true])(
        'accepts captured two-head checkpoint-only advances and rejects hidden project edits: edit=%s',
        async (edit) => {
            const base = getCrdtDoc<Record<string, unknown>>('root');
            if (base === undefined) {
                throw new Error('Root must exist.');
            }
            const local = change(clone(base, { actor: '3333333333333333' }), (doc) => {
                doc.tempo = 120;
            });
            const remote = change(clone(base, { actor: '4444444444444444' }), (doc) => {
                doc.label = 'mix';
                doc.tempo = 120;
            });
            const localBranch = clone(local);
            const remoteBranch = clone(remote);
            replaceCrdtDocInLineage({ id: 'root', doc: merge(local, remote) });
            expect(getHeads(getCrdtDoc('root')!)).toHaveLength(2);
            const projectRevision = captureProjectRevision();
            const truth = toJS(getCrdtDoc('root')!);
            mocks.worker.mockImplementation(async () => {
                const left = change(localBranch, (doc) => {
                    if (edit) {
                        doc.tempo = 128;
                    }
                    doc.commandBatchIdempotency = { records: [{ batchId: 'left' }] };
                });
                const right = change(remoteBranch, (doc) => {
                    doc.commandBatchIdempotency = { records: [{ batchId: 'right' }] };
                });
                replaceCrdtDocInLineage({ id: 'root', doc: merge(left, right) });
                return { status: 'complete', hits: [{ sampleOffset: 512, confidence: 1 }] };
            });
            const result = await readClipTransientOnsets({
                projectRevision,
                projectId: 'project-1',
                clipId: 'clip-1',
                sensitivity: 0.5,
                maxSourceSeconds: 600,
                maxChannelSamples: 10_000_000,
                timeoutMs: 10_000,
                onAnalysisStarted: vi.fn(),
            });
            const { commandBatchIdempotency: _checkpoint, ...currentTruth } = toJS(
                getCrdtDoc<Record<string, unknown>>('root')!
            );
            expect(currentTruth).toEqual(truth);
            expect(result.status).toBe(edit ? 'failed' : 'complete');
            if (result.status === 'complete') {
                expect(result.isCurrent()).toBe(true);
                const root = getCrdtDoc<Record<string, unknown>>('root')!;
                replaceCrdtDocInLineage({
                    id: 'root',
                    doc: change(clone(root), (doc) => {
                        doc.tempo = 150;
                    }),
                });
                expect(result.isCurrent()).toBe(false);
            } else {
                expect(result.code).toBe('stale-source');
            }
        }
    );
});
