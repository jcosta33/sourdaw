import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import * as A from '@automerge/automerge';
import { initializeWasm } from '@automerge/automerge/slim';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { hasOpaqueNativeMetadata } from '../../models/NativeMutationSequence';
import { type ProspectiveMutationWorkerResult } from '../../models/ProspectiveMutationWorkerProtocol';
import { materializeProspectiveMutation } from '../../workers/prospectiveMutationWorkerRuntime';
import { admitBoundedNativeSequence } from '../admitBoundedNativeSequence';

vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return {
        ...actual,
        free: vi.fn(actual.free),
        applyChanges: vi.fn(actual.applyChanges),
        decodeChange: vi.fn(actual.decodeChange),
        encodeChange: vi.fn(actual.encodeChange),
    };
});

const ACTOR = 'aaaaaaaaaaaaaaaa';
const PEER = 'bbbbbbbbbbbbbbbb';
type State = { slot: { text: string }; unrelated?: string; _storagePublicationEvidence?: unknown[] };

beforeAll(async () => {
    const require = createRequire(import.meta.url);
    await initializeWasm(Uint8Array.from(readFileSync(require.resolve('@automerge/automerge/automerge.wasm'))));
});

function fixture(peer = false) {
    let source = A.from<State>({ slot: { text: '' } }, { actor: ACTOR });
    if (peer) {
        const other = A.change(A.clone(source, { actor: PEER }), (draft) => {
            draft.unrelated = 'Peer maximum '.repeat(300);
        });
        source = A.merge(A.clone(source, { actor: ACTOR }), other);
        A.free(other);
    }
    const target = { text: 'Native sequence '.repeat(180), confidence: 0.9517297589061063 };
    const encoding = A.clone(source, { actor: ACTOR });
    let seed: Uint8Array<ArrayBuffer>;
    try {
        seed = Uint8Array.from(A.getBackend(encoding).saveNoCompress());
    } finally {
        A.free(encoding);
    }
    const result = materializeProspectiveMutation({
        seed,
        actor: ACTOR,
        heads: A.getHeads(source),
        preparationPolicy: 'bounded-native-sequence-v1',
        message: 'Capture',
        time: 0,
        mutation: {
            kind: 'canonical-json-slot-v1',
            key: 'slot',
            baseValue: { text: '' },
            value: target,
            documentPresence: { slot: { text: '' } },
        },
    });
    expect(result.changes.length).toBeGreaterThan(1);
    return { source, target, result };
}

function admit(source: A.Doc<State>, result: ProspectiveMutationWorkerResult) {
    return admitBoundedNativeSequence({
        source,
        candidate: A.clone(source, { actor: ACTOR }),
        result,
        actor: ACTOR,
        previousHeads: A.getHeads(source),
        key: 'slot',
        message: 'Capture',
        signal: new AbortController().signal,
        assertCurrent: () => undefined,
    });
}

function replaceFirst(result: ProspectiveMutationWorkerResult, edit: (value: A.DecodedChange) => A.DecodedChange) {
    const first = result.changes[0];
    if (!first) {
        throw new Error('Expected a real native first chunk');
    }
    const { hash: _hash, ...change } = edit(A.decodeChange(first));
    return { ...result, changes: [Uint8Array.from(A.encodeChange(change)), ...result.changes.slice(1)] };
}

function corruptChecksum(bytes: Uint8Array | undefined): void {
    const checksumByte = bytes?.[4];
    if (!bytes || checksumByte === undefined) {
        throw new Error('Checksum rejection requires an existing native change checksum byte');
    }
    bytes[4] = checksumByte ^ 1;
}

function withOpaqueExtra(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    if (bytes[8] !== 1) {
        throw new Error('Opaque control requires native type1');
    }
    let offset = 9;
    while (bytes[offset] !== undefined && (bytes[offset]! & 0x80) !== 0) {
        offset++;
    }
    const body = Uint8Array.from([...bytes.subarray(offset + 1), 0xde, 0xad]);
    const length: number[] = [];
    let remaining = body.length;
    do {
        const byte = remaining & 0x7f;
        remaining = Math.floor(remaining / 128);
        length.push(byte | (remaining > 0 ? 0x80 : 0));
    } while (remaining > 0);
    const payload = Uint8Array.from([1, ...length, ...body]);
    const checksum = createHash('sha256').update(payload).digest().subarray(0, 4);
    return Uint8Array.from([...bytes.subarray(0, 4), ...checksum, ...payload]);
}

describe('bounded native sequence authority', () => {
    it('decodes each received chunk once and still validates its canonical round trip', async () => {
        const { source, result, target } = fixture();
        const decode = vi.mocked(A.decodeChange).mockClear();
        const encode = vi.mocked(A.encodeChange).mockClear();
        const apply = vi.mocked(A.applyChanges).mockClear();
        try {
            const candidate = await admit(source, result);
            try {
                const decodes = decode.mock.results.map((outcome, index) => {
                    if (outcome.type !== 'return') {
                        throw new Error('Expected a completed native decode');
                    }
                    return {
                        order: decode.mock.invocationCallOrder[index]!,
                        bytes: decode.mock.calls[index]![0],
                        change: outcome.value,
                    };
                });
                expect(encode).toHaveBeenCalledTimes(result.changes.length);
                expect(apply).toHaveBeenCalledTimes(result.changes.length);

                let previousApply = 0;
                let observedDecodes = 0;
                let observedFloatRepair = false;
                for (const [index, bytes] of result.changes.entries()) {
                    const encodeOrder = encode.mock.invocationCallOrder[index]!;
                    const applyOrder = apply.mock.invocationCallOrder[index]!;
                    expect(encodeOrder).toBeGreaterThan(previousApply);
                    expect(applyOrder).toBeGreaterThan(encodeOrder);

                    const incoming = decodes.filter(({ order }) => previousApply < order && order < encodeOrder);
                    expect(incoming.map((entry) => entry.bytes)).toEqual([bytes]);
                    const received = incoming[0]!.change;

                    const canonical = decodes.filter(({ order }) => encodeOrder < order && order < applyOrder);
                    expect(canonical.length).toBeGreaterThanOrEqual(1);
                    const encoded = canonical[0]!.change;
                    const repairedFloat = received.ops.some(
                        (op, opIndex) => op.datatype === 'float64' && !Object.is(op.value, encoded.ops[opIndex]?.value)
                    );
                    expect(canonical).toHaveLength(repairedFloat ? 2 : 1);
                    expect(canonical.at(-1)?.change.hash).toBe(received.hash);
                    expect(apply.mock.calls[index]?.[1]).toEqual([bytes]);

                    observedDecodes += incoming.length + canonical.length;
                    observedFloatRepair ||= repairedFloat;
                    previousApply = applyOrder;
                }
                expect(decodes).toHaveLength(observedDecodes);
                expect(observedFloatRepair).toBe(true);
                expect(A.toJS(candidate)).toEqual({ slot: target });
            } finally {
                A.free(candidate);
            }
        } finally {
            A.free(source);
        }
    });

    it('preserves a larger peer maxOp, complete source history, cursor and subsequent actor sequence', async () => {
        const { source, result, target } = fixture(true);
        const history = A.getChangesMetaSince(source, []);
        const heads = A.getHeads(source);
        const truth = A.toJS(source);
        const control = A.clone(source, { actor: ACTOR });
        const cursor = A.saveIncremental(control);
        A.free(control);
        expect(cursor.length).toBeGreaterThan(0);
        const first = A.decodeChange(result.changes[0]!);
        expect(first.startOp).toBe(Math.max(...history.map((entry) => entry.maxOp)) + 1);
        expect(history.find((entry) => entry.actor === PEER)?.maxOp).toBeGreaterThan(
            history.find((entry) => entry.actor === ACTOR)?.maxOp ?? 0
        );
        let candidate = await admit(source, result);
        try {
            expect(A.toJS(candidate)).toEqual({ ...truth, slot: target });
            expect(A.getChangesMetaSince(candidate, []).slice(0, history.length)).toEqual(history);
            expect(A.getMissingDeps(candidate, heads)).toEqual([]);
            expect(A.getHeads(candidate)).toEqual(result.heads);
            const previous = A.getChangesMetaSince(candidate, heads).at(-1);
            candidate = A.change(candidate, (draft) => {
                draft.slot.text += '!';
            });
            expect(A.decodeChange(A.getLastLocalChange(candidate)!)).toMatchObject({
                actor: ACTOR,
                seq: (previous?.seq ?? 0) + 1,
            });
            expect(A.getHeads(source)).toEqual(heads);
            expect(A.toJS(source)).toEqual(truth);
            expect(A.getChangesMetaSince(source, [])).toEqual(history);
            expect(A.saveIncremental(source)).toEqual(cursor);
        } finally {
            A.free(candidate);
            A.free(source);
        }
    });

    it.each([
        'actor',
        'author',
        'well-hashed-malformed',
        'skipped-sequence',
        'start-op',
        'dependencies',
        'checksum',
        'truncated',
        'type2',
        'oversized',
        'missing',
        'reordered',
        'duplicate',
        'final-heads',
    ] as const)('rejects %s before any live publication', async (kind) => {
        const { source, result } = fixture();
        const truth = A.toJS(source);
        const heads = A.getHeads(source);
        let invalid: ProspectiveMutationWorkerResult = result;
        let authoredControl:
            | { author: ReturnType<typeof A.getAuthor>; changeAuthor: ReturnType<typeof A.getAuthor> | undefined }
            | undefined;
        let type2Control: number | undefined;
        if (kind === 'author') {
            const authored = A.change(
                A.clone(source, { actor: ACTOR, author: 'cccccccccccccccc' }),
                { message: 'Capture', time: 0 },
                (draft) => {
                    draft.slot.text = 'authored';
                }
            );
            try {
                const bytes = Uint8Array.from(A.getLastLocalChange(authored)!);
                authoredControl = {
                    author: A.getAuthor(authored),
                    changeAuthor: A.getChangesMetaSince(authored, heads)[0]?.author,
                };
                invalid = {
                    changes: [bytes],
                    heads: A.getHeads(authored),
                    sequence: { changeCount: 1, operationCount: A.decodeChange(bytes).ops.length },
                };
            } finally {
                A.free(authored);
            }
        }
        if (kind === 'well-hashed-malformed') {
            const payload = Uint8Array.of(1, 1, 0);
            const checksum = createHash('sha256').update(payload).digest().subarray(0, 4);
            invalid = {
                ...result,
                changes: [
                    Uint8Array.from([0x85, 0x6f, 0x4a, 0x83, ...checksum, ...payload]),
                    ...result.changes.slice(1),
                ],
            };
        }
        if (kind === 'actor') {
            invalid = replaceFirst(result, (value) => ({ ...value, actor: PEER }));
        }
        if (kind === 'skipped-sequence') {
            invalid = replaceFirst(result, (value) => ({ ...value, seq: value.seq + 1 }));
        }
        if (kind === 'start-op') {
            invalid = replaceFirst(result, (value) => ({ ...value, startOp: value.startOp + 1 }));
        }
        if (kind === 'dependencies') {
            invalid = replaceFirst(result, (value) => ({ ...value, deps: [] }));
        }
        if (kind === 'checksum' || kind === 'type2') {
            const received = result.changes[0];
            if (!received) {
                throw new Error('Expected an actual first native change to corrupt');
            }
            const first = Uint8Array.from(received);
            if (kind === 'type2') {
                first[8] = 2;
                type2Control = first[8];
            } else {
                corruptChecksum(first);
            }
            invalid = { ...result, changes: [first, ...result.changes.slice(1)] };
        }
        if (kind === 'truncated') {
            invalid = {
                ...result,
                changes: [Uint8Array.from(result.changes[0]!.subarray(0, -1)), ...result.changes.slice(1)],
            };
        }
        if (kind === 'oversized') {
            invalid = { ...result, changes: [new Uint8Array(65_537), ...result.changes.slice(1)] };
        }
        if (kind === 'missing') {
            invalid = { ...result, changes: result.changes.slice(1) };
        }
        if (kind === 'reordered') {
            invalid = { ...result, changes: [...result.changes].reverse() };
        }
        if (kind === 'duplicate') {
            invalid = { ...result, changes: [result.changes[0]!, ...result.changes.slice(0, -1)] };
        }
        if (kind === 'final-heads') {
            invalid = { ...result, heads };
        }
        const nativeApplicationsBeforeAdmission = vi.mocked(A.applyChanges).mock.calls.length;
        expect(authoredControl).toEqual(
            kind === 'author' ? { author: 'cccccccccccccccc', changeAuthor: 'cccccccccccccccc' } : undefined
        );
        expect(type2Control).toBe(kind === 'type2' ? 2 : undefined);
        try {
            await expect(admit(source, invalid)).rejects.toThrow(
                kind === 'type2' ? 'Invalid bounded native sequence change' : undefined
            );
            const rejectsBeforeApply = [
                'actor',
                'author',
                'skipped-sequence',
                'start-op',
                'dependencies',
                'checksum',
                'type2',
                'oversized',
            ].includes(kind);
            let unexpectedApplications = 0;
            if (rejectsBeforeApply) {
                unexpectedApplications =
                    vi.mocked(A.applyChanges).mock.calls.length - nativeApplicationsBeforeAdmission;
            }
            expect(unexpectedApplications).toBe(0);
            expect(A.toJS(source)).toEqual(truth);
            expect(A.getHeads(source)).toEqual(heads);
        } finally {
            A.free(source);
        }
    });

    it('rejects native-valid opaque extra metadata before applying its first chunk', async () => {
        const { source, result } = fixture();
        const first = withOpaqueExtra(result.changes[0]!);
        let control = A.clone(source, { actor: ACTOR });
        try {
            [control] = A.applyChanges(control, [first]);
            const metadata = A.getChangesMetaSince(control, A.getHeads(source));
            expect(metadata).toHaveLength(1);
            expect(metadata[0]?.extraBytes).toBeTruthy();
            expect(A.getMissingDeps(control, [])).toEqual([]);
            const decoded = A.decodeChange(first);
            const diagnostic = {
                keys: Object.keys(decoded),
                extraBytes: Reflect.get(decoded, 'extra_bytes'),
                encodedHash: A.decodeChange(A.encodeChange(decoded)).hash,
            };
            expect(hasOpaqueNativeMetadata(decoded), JSON.stringify(diagnostic)).toBe(true);
            await expect(admit(source, { ...result, changes: [first, ...result.changes.slice(1)] })).rejects.toThrow(
                'changed captured authority'
            );
        } finally {
            A.free(control);
            A.free(source);
        }
    });

    it('rejects a valid final unowned write at the patch guard, with correct actor and sequence metadata', async () => {
        const { source, result } = fixture();
        let control = A.clone(source, { actor: ACTOR });
        try {
            [control] = A.applyChanges(control, result.changes);
            control = A.change(control, { message: 'Capture', time: 0 }, (draft) => {
                draft.unrelated = 'forbidden';
            });
            const last = Uint8Array.from(A.getLastLocalChange(control)!);
            const count = A.decodeChange(last).ops.length;
            if (!result.sequence) {
                throw new Error('Sequence membership missing');
            }
            const invalid = {
                changes: [...result.changes, last],
                heads: A.getHeads(control),
                sequence: {
                    changeCount: result.changes.length + 1,
                    operationCount: result.sequence.operationCount + count,
                },
            };
            await expect(admit(source, invalid)).rejects.toThrow('changed an unowned slot');
            expect(A.toJS(source)).toEqual({ slot: { text: '' } });
        } finally {
            A.free(control);
            A.free(source);
        }
    });

    it.each(['checksum', 'cancel'] as const)(
        'frees its owned private backend once after %s, without freeing its borrowed source',
        async (failure) => {
            const { source, result } = fixture();
            const candidate = A.clone(source, { actor: ACTOR });
            const backend = A.getBackend(candidate);
            const borrowed = A.getBackend(source);
            const controller = new AbortController();
            const before = vi.mocked(A.free).mock.calls.length;
            if (failure === 'checksum') {
                corruptChecksum(result.changes[0]);
            }
            const requested = admitBoundedNativeSequence({
                source,
                candidate,
                result,
                actor: ACTOR,
                previousHeads: A.getHeads(source),
                key: 'slot',
                message: 'Capture',
                signal: controller.signal,
                assertCurrent: () => undefined,
            });
            if (failure === 'cancel') {
                controller.abort(new Error('Preparation cancelled'));
            }
            await expect(requested).rejects.toThrow();
            const freed = vi
                .mocked(A.free)
                .mock.calls.slice(before)
                .map(([document]) => A.getBackend(document));
            expect(freed.filter((handle) => handle === backend)).toHaveLength(1);
            expect(freed).not.toContain(borrowed);
            expect(A.toJS(source)).toEqual({ slot: { text: '' } });
            A.free(source);
        }
    );

    it('preserves heads for an empty sequence and refuses evidence-only retirement', async () => {
        const source = A.from<State>(
            { slot: { text: '' }, _storagePublicationEvidence: [{ previous: true }] },
            { actor: ACTOR }
        );
        const heads = A.getHeads(source);
        const candidate = await admit(source, { changes: [], heads, sequence: { changeCount: 0, operationCount: 0 } });
        A.free(candidate);
        let control = A.clone(source, { actor: ACTOR });
        try {
            control = A.change(control, { message: 'Capture', time: 0 }, (draft) => {
                delete draft._storagePublicationEvidence;
            });
            const bytes = Uint8Array.from(A.getLastLocalChange(control)!);
            await expect(
                admit(source, {
                    changes: [bytes],
                    heads: A.getHeads(control),
                    sequence: { changeCount: 1, operationCount: A.decodeChange(bytes).ops.length },
                })
            ).rejects.toThrow('changed only publication evidence');
            expect(A.getHeads(source)).toEqual(heads);
            expect(source._storagePublicationEvidence).toEqual([{ previous: true }]);
        } finally {
            A.free(control);
            A.free(source);
        }
    });
});
