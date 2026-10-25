import * as Automerge from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { getMidiStoreState } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createdClipMidiCapture } from '../createdClipMidiCapture';

const mocks = vi.hoisted(() => ({
    owner: undefined as object | undefined,
    identity: 'project-epoch-1',
    root: undefined as Automerge.Doc<{ name: string }> | undefined,
    midi: null as ReturnType<typeof getMidiStoreState>,
    tracks: [] as { id: string; clips: { id: string }[] }[],
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    getCurrentAutomergeStorageMutationOwner: () => mocks.owner,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectIdentity: () => mocks.identity,
    getCrdtDoc: () => mocks.root,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ getMidiStoreState: () => mocks.midi }));
vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => ({ tracks: mocks.tracks }),
}));

function action(): Extract<AppAction, { type: 'duplicateClipAt' }> {
    return {
        type: 'duplicateClipAt',
        payload: { clipId: 'source', targetClipId: 'copy', destinationTrackId: 'track', startBeat: 4 },
    };
}

function constructed() {
    return {
        notes: {
            present: true,
            value: [
                {
                    id: 'new-note',
                    pitch: 60,
                    startBeat: 0,
                    duration: 1,
                    velocity: 90,
                    expression: { pressure: [{ offsetBeats: 0.5, value: 0.25 }] },
                },
            ],
        },
        controlChanges: { present: false, value: [] },
        pitchBends: { present: false, value: [] },
    };
}

function install(snapshot: ReturnType<typeof constructed>): void {
    mocks.tracks = [{ id: 'track', clips: [{ id: 'copy' }] }];
    mocks.midi = {
        probabilitySeed: 1,
        notesByClipId: snapshot.notes.present ? { copy: structuredClone([...snapshot.notes.value]) } : {},
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

function prepare(creator: ReturnType<typeof action>) {
    const prepared = createdClipMidiCapture({ phase: 'prepare', action: creator, clipId: 'copy' });
    if (!prepared) {
        throw new Error('Expected owned creation admission');
    }
    return prepared;
}

describe('createdClipMidiCapture execution authority', () => {
    beforeEach(() => {
        mocks.owner = {};
        mocks.identity = 'project-epoch-1';
        mocks.root = Automerge.from({ name: 'Original project' });
        mocks.midi = { probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        mocks.tracks = [];
    });

    it('requires a completed exact creator and defensively stages its constructed nested values', () => {
        const creator = action();
        const prepared = prepare(creator);
        const output = constructed();
        prepared.stage(output);
        install(output);
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toBeNull();
        expect(prepared.complete()).toBe(true);
        output.notes.value[0]!.expression.pressure[0]!.value = 0.75;
        expect(createdClipMidiCapture({ phase: 'take', action: action(), clipId: 'copy' })).toBeNull();
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toEqual(constructed());
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toBeNull();
    });

    it('refuses to adopt a synchronous observer edit to constructed output', () => {
        const creator = action();
        const prepared = prepare(creator);
        prepared.stage(constructed());
        const edited = structuredClone(constructed());
        install(edited);
        mocks.midi!.notesByClipId.copy![0]!.velocity = 42;
        expect(prepared.complete()).toBe(false);
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toBeNull();
    });

    it('accepts an equivalent installed-lineage clone while preserving explicitly proved empty MIDI', () => {
        const creator = action();
        const prepared = prepare(creator);
        mocks.tracks = [{ id: 'track', clips: [{ id: 'copy' }] }];
        expect(prepared.complete()).toBe(true);
        mocks.root = Automerge.clone(mocks.root!);
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toEqual({
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        });
    });

    it.each(['owner', 'root', 'rollback', 'frontier', 'discard'] as const)(
        'rejects a stale receipt after %s changes',
        (change) => {
            const original = mocks.root!;
            mocks.root = Automerge.change(original, (draft) => {
                draft.name = 'Current project';
            });
            const creator = action();
            const prepared = prepare(creator);
            prepared.stage(constructed());
            install(constructed());
            expect(prepared.complete()).toBe(true);
            if (change === 'owner') {
                mocks.owner = {};
            }
            if (change === 'root') {
                mocks.root = Automerge.clone(mocks.root);
                mocks.identity = 'project-epoch-2';
            }
            if (change === 'rollback') {
                mocks.root = original;
            }
            if (change === 'frontier') {
                mocks.root = Automerge.change(mocks.root, (draft) => {
                    draft.name = 'Later project';
                });
            }
            if (change === 'discard') {
                createdClipMidiCapture({ phase: 'discard', action: creator });
            }
            expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toBeNull();
        }
    );

    it('cannot complete a discarded or rolled-back creator, including an unchanged absent MIDI result', () => {
        const creator = action();
        const prepared = prepare(creator);
        prepared.stage(constructed());
        prepared.discard();
        install(constructed());
        expect(prepared.complete()).toBe(false);
        expect(createdClipMidiCapture({ phase: 'take', action: creator, clipId: 'copy' })).toBeNull();
        mocks.tracks = [];
        mocks.midi!.notesByClipId = {};
        const empty = prepare(creator);
        expect(empty.complete()).toBe(false);
        mocks.tracks = [{ id: 'track', clips: [{ id: 'copy' }] }];
        const otherCreator = action();
        expect(createdClipMidiCapture({ phase: 'prepare', action: otherCreator, clipId: 'copy' })).toBeNull();
    });
});
