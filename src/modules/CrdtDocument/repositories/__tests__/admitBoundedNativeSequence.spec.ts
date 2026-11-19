import * as native from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativePreparationWorker, settleNativePreparationWorkers } from '#/helpers/__tests__/nativePreparationWorker';

import {
    type ProspectiveMutationWorkerRequest,
    type ProspectiveMutationWorkerResult,
} from '../../models/ProspectiveMutationWorkerProtocol';
import { admitBoundedNativeSequence } from '../admitBoundedNativeSequence';
import { requestProspectiveMutation } from '../prospectiveMutationWorkerClient';

const actor = 'aaaaaaaaaaaaaaaa';
const peerActor = 'bbbbbbbbbbbbbbbb';
const float = 0.9517297589061063;
type State = {
    warpStates: { states: { target: { text: string; confidence?: number }; sibling: { text: string } } };
    _storagePublicationEvidence?: { revision: number };
};

beforeEach(() => {
    vi.stubGlobal('Worker', NativePreparationWorker);
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await settleNativePreparationWorkers();
});

function fixture() {
    const initial = native.from<State>(
        {
            warpStates: { states: { target: { text: '' }, sibling: { text: '' } } },
            _storagePublicationEvidence: { revision: 17 },
        },
        { actor }
    );
    let owner = native.clone(initial, { actor });
    for (let index = 0; index < 130; index++) {
        owner = native.change(owner, (draft) => {
            draft.warpStates.states.sibling.text = `Retained owner edit ${index}`;
        });
    }
    const peer = native.change(native.clone(initial, { actor: peerActor }), (draft) => {
        draft.warpStates.states.sibling.text = 'peer authority '.repeat(180);
    });
    const source = native.merge(owner, peer);
    native.free(initial);
    native.free(peer);
    const { target: current, sibling } = source.warpStates.states;
    const base = { states: { target: { text: current.text }, sibling: { text: sibling.text } } };
    const target = { text: 'new markers '.repeat(100), confidence: float };
    const request: ProspectiveMutationWorkerRequest = {
        seed: Uint8Array.from(native.save(source)),
        actor,
        heads: native.getHeads(source),
        message: 'Detect transients',
        time: 7,
        preparationPolicy: 'bounded-native-sequence-v1',
        mutation: {
            kind: 'canonical-json-slot-v1',
            key: 'warpStates',
            baseValue: base,
            value: { states: { ...base.states, target } },
            documentPresence: { slot: base },
        },
    };
    return { source, base, request, target };
}

function requestNativeChanges(request: ProspectiveMutationWorkerRequest) {
    return requestProspectiveMutation(request, new AbortController().signal);
}

function admit(source: native.Doc<State>, result: ProspectiveMutationWorkerResult, signal: AbortSignal) {
    return admitBoundedNativeSequence({
        source,
        candidate: native.clone(source, { actor }),
        result,
        previousHeads: native.getHeads(source),
        actor,
        key: 'warpStates',
        ownedPath: ['states', 'target'],
        message: 'Detect transients',
        signal,
        assertCurrent: () => undefined,
    });
}

describe('bounded Detect response admission', () => {
    it('retains native peer history and exact values across private slices', async () => {
        const { source, request, target } = fixture();
        const sourceValue = native.toJS(source);
        const sourceHistory = native.getChangesMetaSince(source, []);
        const sourceHeads = native.getHeads(source);
        expect(sourceHeads).toHaveLength(2);
        const observedHistory = vi.spyOn(native.getBackend(source), 'getChangeMetaByHash');
        let prepared: native.Doc<State> | undefined;
        try {
            const result = await requestNativeChanges(request);
            expect(result.changes.length).toBeGreaterThan(1);
            prepared = await admit(source, result, new AbortController().signal);
            expect(observedHistory.mock.calls.map(([hash]) => hash).toSorted()).toEqual(
                sourceHistory.map((entry) => entry.hash).toSorted()
            );
            expect(native.getHeads(prepared)).toEqual(result.heads);
            expect(native.getActorId(prepared)).toBe(actor);
            expect(native.getChangesMetaSince(prepared, sourceHeads)).toHaveLength(result.changes.length);
            expect(native.getChangesMetaSince(prepared, []).slice(0, sourceHistory.length)).toEqual(sourceHistory);
            expect(prepared.warpStates.states.target).toEqual(target);
            expect(prepared.warpStates.states.sibling).toEqual(sourceValue.warpStates.states.sibling);
            expect(prepared._storagePublicationEvidence).toBeUndefined();
            expect(native.toJS(source)).toEqual(sourceValue);
            expect(native.getHeads(source)).toEqual(sourceHeads);
            const finalChange = native.getChangesMetaSince(prepared, sourceHeads).at(-1);
            if (!finalChange) {
                throw new Error('Missing final change');
            }
            prepared = native.change(prepared, (draft) => {
                draft.warpStates.states.target.text = 'subsequent real edit';
            });
            const nextChange = native.getChangesMetaSince(prepared, [...result.heads])[0];
            expect(nextChange?.seq).toBe(finalChange.seq + 1);
            expect(nextChange?.startOp).toBe(finalChange.maxOp + 1);
        } finally {
            observedHistory.mockRestore();
            if (prepared) {
                native.free(prepared);
            }
            native.free(source);
        }
    });

    it('refuses a valid same-slot sibling edit with current actor and dependencies', async () => {
        const { source, base, request } = fixture();
        const before = native.toJS(source);
        try {
            const wrongTarget = await requestNativeChanges({
                ...request,
                mutation: { ...request.mutation, value: { states: { ...base.states, sibling: { text: 'foreign' } } } },
            });
            await expect(admit(source, wrongTarget, new AbortController().signal)).rejects.toThrow(
                'Prospective mutation Worker changed outside its owned path'
            );
            expect(native.toJS(source)).toEqual(before);
        } finally {
            native.free(source);
        }
    });

    it('rejects a corrupt final checksum after a private prefix and preserves the source', async () => {
        const { source, request } = fixture();
        const before = native.toJS(source);
        try {
            const result = await requestNativeChanges(request);
            expect(result.changes.length).toBeGreaterThan(1);
            const bytes = result.changes.at(-1);
            if (!bytes) {
                throw new Error('Expected final change');
            }
            bytes[4] = (bytes[4] ?? 0) ^ 0xff;
            await expect(admit(source, result, new AbortController().signal)).rejects.toThrow(
                'invalid change checksum'
            );
            expect(native.toJS(source)).toEqual(before);
            expect(native.getHeads(source)).toEqual(request.heads);
        } finally {
            native.free(source);
        }
    });

    it('cancels from a host task while the candidate is still private', async () => {
        const { source, request } = fixture();
        const before = native.toJS(source);
        const controller = new AbortController();
        try {
            const result = await requestNativeChanges(request);
            const pending = admit(source, result, controller.signal);
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                controller.abort(new Error('Preparation cancelled'));
            };
            channel.port2.postMessage(undefined);
            await expect(pending).rejects.toThrow('Preparation cancelled');
            expect(native.toJS(source)).toEqual(before);
        } finally {
            native.free(source);
        }
    });

    it('keeps a zero-operation reply on the captured heads', async () => {
        const { source, request, base } = fixture();
        try {
            const result = await requestNativeChanges({
                ...request,
                mutation: { ...request.mutation, value: base },
            });
            expect(result.sequence).toEqual({ changeCount: 0, operationCount: 0 });
            const prepared = await admit(source, result, new AbortController().signal);
            try {
                expect(native.getHeads(prepared)).toEqual(request.heads);
                expect(prepared._storagePublicationEvidence).toEqual({ revision: 17 });
            } finally {
                native.free(prepared);
            }
        } finally {
            native.free(source);
        }
    });
});
