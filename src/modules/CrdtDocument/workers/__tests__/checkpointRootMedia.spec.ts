import { change, free, getHeads, init, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AnyDoc = Record<string, unknown>;

type WorkerResponse =
    | { id: number; type: 'loaded'; compacted: [string, Uint8Array][]; rootId: string }
    | { id: number; type: 'compacted'; bundle: [string, Uint8Array][] }
    | { id: number; type: 'compactStale'; reason: string }
    | { id: number; type: 'checkpointRootMediaInspected'; audioBufferIds: string[] }
    | { id: number; type: 'error'; message: string };

function saveRoot(value: AnyDoc): Uint8Array {
    let document = init<AnyDoc>('aaaaaaaaaaaaaaaa');
    document = change(document, (draft) => {
        Object.assign(draft, value);
    });
    const bytes = save(document);
    free(document);
    return bytes;
}

describe('checkpoint root media worker inspection', () => {
    const originalPostMessage = (self as unknown as { postMessage?: unknown }).postMessage;
    let posted: WorkerResponse[];
    let onmessage: ((event: { data: unknown }) => void) | null;

    beforeEach(async () => {
        posted = [];
        (self as unknown as { postMessage: (message: WorkerResponse) => void }).postMessage = (message) => {
            posted.push(message);
        };
        vi.resetModules();
        await import('../crdtWorker');
        onmessage = (self as unknown as { onmessage: typeof onmessage }).onmessage;
    });

    afterEach(() => {
        (self as unknown as { postMessage?: unknown }).postMessage = originalPostMessage;
    });

    function dispatch(data: unknown): WorkerResponse {
        onmessage!({ data });
        expect(posted).toHaveLength(1);
        return posted.shift()!;
    }

    it('returns unique sorted ids from live, cached-current, inactive, alternative, and frozen track state', () => {
        const rootBytes = saveRoot({
            audioBufferId: 'ignore-root-field',
            tracks: {
                tracks: [
                    {
                        clips: [
                            { audioBufferId: 'live-buffer' },
                            { audioBufferId: 'live-buffer' },
                            { bufferId: 'ignored-legacy-buffer' },
                        ],
                        alternatives: [
                            {
                                clips: [{ audioBufferId: 'alternative-buffer' }, { audioBufferId: 'live-buffer' }],
                            },
                        ],
                        freezeState: { frozenBufferId: 'freeze-state-buffer' },
                        frozenBufferId: 'track-frozen-buffer',
                    },
                ],
            },
            arrangements: {
                activeArrangementId: 'arrangement-current',
                arrangements: [
                    {
                        id: 'arrangement-current',
                        tracks: {
                            tracks: [
                                {
                                    clips: [{ audioBufferId: 'current-cached-buffer' }],
                                    alternatives: [],
                                    freezeState: {},
                                },
                            ],
                        },
                    },
                    {
                        id: 'arrangement-inactive',
                        tracks: {
                            tracks: [
                                {
                                    clips: [{ audioBufferId: 'inactive-buffer' }],
                                    alternatives: [{ clips: [{ audioBufferId: 'alternative-buffer' }] }],
                                    freezeState: { frozenBufferId: '' },
                                    frozenBufferId: '',
                                },
                            ],
                        },
                    },
                ],
            },
        });

        const response = dispatch({ id: 8, type: 'inspectCheckpointRootMedia', rootBytes });

        expect(response).toEqual({
            id: 8,
            type: 'checkpointRootMediaInspected',
            audioBufferIds: [
                'alternative-buffer',
                'current-cached-buffer',
                'freeze-state-buffer',
                'inactive-buffer',
                'live-buffer',
                'track-frozen-buffer',
            ],
        });
    });

    it('accepts an empty project and absent optional census structures', () => {
        const response = dispatch({ id: 9, type: 'inspectCheckpointRootMedia', rootBytes: saveRoot({}) });

        expect(response).toEqual({ id: 9, type: 'checkpointRootMediaInspected', audioBufferIds: [] });
    });

    it('rejects invalid Automerge bytes', () => {
        const response = dispatch({
            id: 10,
            type: 'inspectCheckpointRootMedia',
            rootBytes: new Uint8Array([255, 0, 19]),
        });

        expect(response.type).toBe('error');
    });

    it.each([
        ['root tracks section', { tracks: 'not-an-object' }],
        ['root tracks array', { tracks: { tracks: 'not-an-array' } }],
        ['arrangement tracks section', { arrangements: { arrangements: [{ tracks: 'not-an-object' }] } }],
        ['clip list', { arrangements: { arrangements: [{ tracks: { tracks: [{ clips: 'not-an-array' }] } }] } }],
        ['alternative list', { tracks: { tracks: [{ alternatives: 'not-an-array' }] } }],
        ['freeze state', { tracks: { tracks: [{ freezeState: 'not-an-object' }] } }],
        ['audio reference', { tracks: { tracks: [{ clips: [{ audioBufferId: 42 }] }] } }],
    ])('rejects a malformed present %s', (_label, malformedRoot) => {
        const response = dispatch({
            id: 11,
            type: 'inspectCheckpointRootMedia',
            rootBytes: saveRoot(malformedRoot),
        });

        expect(response.type).toBe('error');
    });

    it('does not replace the retained compaction shadow with the inspected checkpoint', () => {
        const rootA = saveRoot({ projectMarker: 'project-a' });
        const loadedA = dispatch({
            id: 12,
            type: 'loadBundle',
            bundle: [['root', rootA]],
            retainShadow: true,
        });
        expect(loadedA.type).toBe('loaded');

        const rootB = saveRoot({
            projectMarker: 'project-b',
            tracks: { tracks: [{ clips: [{ audioBufferId: 'checkpoint-b-buffer' }] }] },
        });
        const inspectedB = dispatch({ id: 13, type: 'inspectCheckpointRootMedia', rootBytes: rootB });
        expect(inspectedB).toEqual({
            id: 13,
            type: 'checkpointRootMediaInspected',
            audioBufferIds: ['checkpoint-b-buffer'],
        });

        const documentA = load<AnyDoc>(rootA);
        const headsA = getHeads(documentA);
        free(documentA);
        const compactedA = dispatch({
            id: 14,
            type: 'compactShadow',
            seeds: [],
            deltas: [],
            removedDocIds: [],
            expectedHeads: [['root', headsA]],
        });

        expect(compactedA.type).toBe('compacted');
        if (compactedA.type !== 'compacted') {
            throw new Error(`Expected compacted response, got ${compactedA.type}`);
        }
        const compactedRoot = load<AnyDoc>(new Map(compactedA.bundle).get('root')!);
        expect(compactedRoot.projectMarker).toBe('project-a');
        expect(compactedRoot).not.toHaveProperty('tracks');
        free(compactedRoot);
    });
});
