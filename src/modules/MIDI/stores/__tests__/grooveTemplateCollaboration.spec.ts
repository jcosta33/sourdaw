import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { createBuiltinGrooveTemplates } from '../../models/BuiltinGrooveTemplates';
import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { createGrooveTemplateAutomergeStorage } from '../grooveTemplateAutomergeStorage';
import { type GrooveTemplateState } from '../grooveTemplateStore';

type RootDocument = { grooveTemplates?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

// Automerge orders root conflicts by op id (`counter@actorId`), and the storage
// adapter feeds the resolver in that order. Pinning the actor ids makes the
// "first peer seen" deterministic, so a resolver that silently keeps whichever
// peer arrives first is distinguishable from one that breaks the tie on content.
const FIRST_SEEN_ACTOR_ID = '00000000000000000000000000000011';
const LAST_SEEN_ACTOR_ID = '000000000000000000000000000000ff';

function createTemplate(id: string): GrooveTemplate {
    return {
        id,
        name: id,
        schemaVersion: 1,
        subdivision: '1/16',
        slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
        provenance: { type: 'user', sourceId: id },
    };
}

function createPeer(initialDoc: Doc<RootDocument>): {
    getDoc: () => Doc<RootDocument>;
    replaceDoc: (nextDoc: Doc<RootDocument>) => void;
    port: TestPort;
} {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        replaceDoc: (nextDoc) => {
            doc = nextDoc;
        },
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                doc = change(doc, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        },
    };
}

function createBaseline(state: GrooveTemplateState): Doc<RootDocument> {
    const peer = createPeer(from<RootDocument>({}));
    const storage = createGrooveTemplateAutomergeStorage();
    configureAutomergeStoragePort(peer.port);
    storage.set(state);
    flushAutomergeStorageWrites();
    return peer.getDoc();
}

function mergePeers({
    leftPeer,
    rightPeer,
    direction,
}: {
    leftPeer: ReturnType<typeof createPeer>;
    rightPeer: ReturnType<typeof createPeer>;
    direction: 'left-right' | 'right-left';
}): GrooveTemplateState {
    const merged =
        direction === 'left-right'
            ? merge(leftPeer.getDoc(), rightPeer.getDoc())
            : merge(rightPeer.getDoc(), leftPeer.getDoc());
    const mergedPeer = createPeer(merged);
    const mergedStorage = createGrooveTemplateAutomergeStorage();
    configureAutomergeStoragePort(mergedPeer.port);
    expect(mergedStorage.hydrate?.()).toBe(true);
    return mergedStorage.get()!;
}

describe('groove template collaboration storage', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it.each(['left-right', 'right-left'] as const)(
        'reconciles concurrent templates and assignments when merged $0',
        (mergeDirection) => {
            const baseline = createBaseline({ templates: createBuiltinGrooveTemplates(), assignments: [] });
            const leftPeer = createPeer(clone(baseline));
            const rightPeer = createPeer(clone(baseline));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            expect(leftStorage.hydrate?.()).toBe(true);
            leftStorage.set({
                templates: [...leftStorage.get()!.templates, createTemplate('left-template')],
                assignments: [
                    {
                        consumerType: 'sequencer',
                        consumerId: 'left-consumer',
                        templateId: 'left-template',
                        amount: 0.5,
                    },
                ],
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            expect(rightStorage.hydrate?.()).toBe(true);
            rightStorage.set({
                templates: [...rightStorage.get()!.templates, createTemplate('right-template')],
                assignments: [
                    {
                        consumerType: 'arpeggiator',
                        consumerId: 'right-consumer',
                        templateId: 'right-template',
                        amount: 0.75,
                    },
                ],
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction: mergeDirection });
            expect(mergedState.templates).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'left-template' }),
                    expect.objectContaining({ id: 'right-template' }),
                ])
            );
            expect(mergedState.assignments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ consumerId: 'left-consumer', templateId: 'left-template' }),
                    expect.objectContaining({ consumerId: 'right-consumer', templateId: 'right-template' }),
                ])
            );
        }
    );

    it('rebases a deferred local template write over a remote hydrate before the animation frame', () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            frameCallbacks.push(callback);
            return 17;
        });
        const baseline = createBaseline({ templates: createBuiltinGrooveTemplates(), assignments: [] });
        const remotePeer = createPeer(clone(baseline));
        const remoteStorage = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.hydrate?.();
        remoteStorage.set({
            templates: [...remoteStorage.get()!.templates, createTemplate('remote-before-frame')],
            assignments: [],
        });
        flushAutomergeStorageWrites();

        const localPeer = createPeer(clone(baseline));
        const localStorage = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate?.();
        localStorage.set({
            templates: [...localStorage.get()!.templates, createTemplate('local-pending')],
            assignments: [],
        });
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate?.()).toBe(true);

        frameCallbacks.at(-1)?.(100);

        const reopened = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(localPeer.port);
        expect(reopened.hydrate?.()).toBe(true);
        expect(reopened.get()!.templates.map((template) => template.id)).toEqual(
            expect.arrayContaining(['local-pending', 'remote-before-frame'])
        );
    });

    it.each(['left-right', 'right-left'] as const)(
        'reconciles concurrent first writes from a keyless legacy root and keeps later edits $0',
        (direction) => {
            const legacyBaseline = from<RootDocument>({
                grooveTemplates: {
                    templates: createBuiltinGrooveTemplates(),
                    assignments: [],
                },
            });
            const leftPeer = createPeer(clone(legacyBaseline));
            const rightPeer = createPeer(clone(legacyBaseline));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            expect(leftStorage.hydrate?.()).toBe(true);
            leftStorage.set({
                templates: [...leftStorage.get()!.templates, createTemplate('legacy-left')],
                assignments: [
                    {
                        consumerType: 'sequencer',
                        consumerId: 'legacy-left-consumer',
                        templateId: 'legacy-left',
                        amount: 0.4,
                    },
                ],
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            expect(rightStorage.hydrate?.()).toBe(true);
            rightStorage.set({
                templates: [...rightStorage.get()!.templates, createTemplate('legacy-right')],
                assignments: [
                    {
                        consumerType: 'clip',
                        consumerId: 'legacy-right-consumer',
                        templateId: 'legacy-right',
                        amount: 0.6,
                    },
                ],
            });
            flushAutomergeStorageWrites();

            const mergedDoc =
                direction === 'left-right'
                    ? merge(leftPeer.getDoc(), rightPeer.getDoc())
                    : merge(rightPeer.getDoc(), leftPeer.getDoc());
            const mergedPeer = createPeer(mergedDoc);
            const mergedStorage = createGrooveTemplateAutomergeStorage();
            configureAutomergeStoragePort(mergedPeer.port);
            expect(mergedStorage.hydrate?.()).toBe(true);
            expect(mergedStorage.get()!.templates.map((template) => template.id)).toEqual(
                expect.arrayContaining(['legacy-left', 'legacy-right'])
            );
            expect(mergedStorage.get()!.assignments.map((assignment) => assignment.consumerId)).toEqual(
                expect.arrayContaining(['legacy-left-consumer', 'legacy-right-consumer'])
            );

            mergedStorage.set({
                templates: mergedStorage
                    .get()!
                    .templates.filter((template) => template.id !== 'legacy-right')
                    .map((template) =>
                        template.id === 'legacy-left' ? { ...template, name: 'Edited after merge' } : template
                    ),
                assignments: mergedStorage
                    .get()!
                    .assignments.filter((assignment) => assignment.consumerId !== 'legacy-right-consumer'),
            });
            flushAutomergeStorageWrites();

            const reopenedPeer = createPeer(clone(mergedPeer.getDoc()));
            const reopenedStorage = createGrooveTemplateAutomergeStorage();
            configureAutomergeStoragePort(reopenedPeer.port);
            expect(reopenedStorage.hydrate?.()).toBe(true);
            expect(reopenedStorage.get()!.templates.find((template) => template.id === 'legacy-left')?.name).toBe(
                'Edited after merge'
            );
            expect(reopenedStorage.get()!.templates.some((template) => template.id === 'legacy-right')).toBe(false);
            expect(reopenedStorage.get()!.assignments).toContainEqual({
                consumerType: 'sequencer',
                consumerId: 'legacy-left-consumer',
                templateId: 'legacy-left',
                amount: 0.4,
            });
            expect(
                reopenedStorage
                    .get()!
                    .assignments.some((assignment) => assignment.consumerId === 'legacy-right-consumer')
            ).toBe(false);
        }
    );

    it.each(['left-right', 'right-left'] as const)(
        'preserves a legacy-root deletion while merging an unrelated first write $0',
        (direction) => {
            const legacyBaseline = from<RootDocument>({
                grooveTemplates: {
                    templates: [...createBuiltinGrooveTemplates(), createTemplate('legacy-delete-me')],
                    assignments: [
                        {
                            consumerType: 'clip',
                            consumerId: 'legacy-deleted-assignment',
                            templateId: 'legacy-delete-me',
                            amount: 1,
                        },
                    ],
                },
            });
            const leftPeer = createPeer(clone(legacyBaseline));
            const rightPeer = createPeer(clone(legacyBaseline));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            expect(leftStorage.hydrate?.()).toBe(true);
            leftStorage.set({
                templates: leftStorage.get()!.templates.filter((template) => template.id !== 'legacy-delete-me'),
                assignments: [],
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            expect(rightStorage.hydrate?.()).toBe(true);
            rightStorage.set({
                ...rightStorage.get()!,
                templates: [...rightStorage.get()!.templates, createTemplate('legacy-unrelated')],
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction });
            expect(mergedState.templates.some((template) => template.id === 'legacy-delete-me')).toBe(false);
            expect(mergedState.templates.some((template) => template.id === 'legacy-unrelated')).toBe(true);
            expect(
                mergedState.assignments.some((assignment) => assignment.consumerId === 'legacy-deleted-assignment')
            ).toBe(false);
        }
    );

    it('keeps a collapsed legacy deletion causal against a later stale-peer write', () => {
        const legacyBaseline = from<RootDocument>({
            grooveTemplates: {
                templates: [...createBuiltinGrooveTemplates(), createTemplate('stale-delete-me')],
                assignments: [],
            },
        });
        const deletingPeer = createPeer(clone(legacyBaseline));
        const concurrentPeer = createPeer(clone(legacyBaseline));
        const stalePeer = createPeer(clone(legacyBaseline));
        const deletingStorage = createGrooveTemplateAutomergeStorage();
        const concurrentStorage = createGrooveTemplateAutomergeStorage();

        configureAutomergeStoragePort(deletingPeer.port);
        deletingStorage.hydrate?.();
        deletingStorage.set({
            templates: deletingStorage.get()!.templates.filter((template) => template.id !== 'stale-delete-me'),
            assignments: [],
        });
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(concurrentPeer.port);
        concurrentStorage.hydrate?.();
        concurrentStorage.set({
            templates: [...concurrentStorage.get()!.templates, createTemplate('first-concurrent-write')],
            assignments: [],
        });
        flushAutomergeStorageWrites();

        const conflictDoc = merge(deletingPeer.getDoc(), concurrentPeer.getDoc());
        const collapsedPeer = createPeer(conflictDoc);
        const collapsedStorage = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(collapsedPeer.port);
        expect(collapsedStorage.hydrate?.()).toBe(true);
        collapsedStorage.set({
            templates: [...collapsedStorage.get()!.templates, createTemplate('collapse-write')],
            assignments: [],
        });
        flushAutomergeStorageWrites();

        const staleStorage = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(stalePeer.port);
        staleStorage.hydrate?.();
        staleStorage.set({
            templates: [...staleStorage.get()!.templates, createTemplate('stale-unrelated-write')],
            assignments: [],
        });
        flushAutomergeStorageWrites();

        const finalState = mergePeers({ leftPeer: collapsedPeer, rightPeer: stalePeer, direction: 'left-right' });
        expect(finalState.templates.some((template) => template.id === 'stale-delete-me')).toBe(false);
        expect(finalState.templates.map((template) => template.id)).toEqual(
            expect.arrayContaining(['collapse-write', 'stale-unrelated-write'])
        );
    });

    it('refuses to hydrate or overwrite an unsupported CRDT schema', () => {
        const peer = createPeer(
            from<RootDocument>({
                grooveTemplates: {
                    schemaVersion: 2,
                    templates: { future: { deleted: false, value: createTemplate('future') } },
                    assignments: {},
                },
            })
        );
        const storage = createGrooveTemplateAutomergeStorage();
        configureAutomergeStoragePort(peer.port);

        expect(() => storage.hydrate?.()).toThrow('Unsupported groove CRDT schema version: 2');
        // Overwrite attempts go through the storage transaction API (#576):
        // a refused commit stays queued for explicit rollback, so the test must
        // abort — otherwise the retained refusal rethrows on every later flush
        // (including the shared afterEach cleanup).
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ templates: createBuiltinGrooveTemplates(), assignments: [] });
        });
        expect(() => transaction.commit()).toThrow('Unsupported groove CRDT schema version: 2');
        transaction.abort();
        expect((peer.getDoc().grooveTemplates as { schemaVersion: number }).schemaVersion).toBe(2);
    });

    it.each(['left-right', 'right-left'] as const)(
        'keeps a deletion causal while merging an unrelated template write $0',
        (direction) => {
            const baseline = createBaseline({
                templates: [...createBuiltinGrooveTemplates(), createTemplate('delete-me')],
                assignments: [],
            });
            const leftPeer = createPeer(clone(baseline));
            const rightPeer = createPeer(clone(baseline));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            leftStorage.hydrate?.();
            leftStorage.set({
                templates: leftStorage.get()!.templates.filter((template) => template.id !== 'delete-me'),
                assignments: [],
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            rightStorage.hydrate?.();
            rightStorage.set({
                templates: [...rightStorage.get()!.templates, createTemplate('unrelated-write')],
                assignments: [],
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction });
            expect(mergedState.templates.some((template) => template.id === 'delete-me')).toBe(false);
            expect(mergedState.templates.some((template) => template.id === 'unrelated-write')).toBe(true);
        }
    );

    it.each(['left-right', 'right-left'] as const)(
        'merges a rename with an assignment to the same template $0',
        (direction) => {
            const baseline = createBaseline({
                templates: [...createBuiltinGrooveTemplates(), createTemplate('shared-template')],
                assignments: [],
            });
            const leftPeer = createPeer(clone(baseline));
            const rightPeer = createPeer(clone(baseline));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            leftStorage.hydrate?.();
            leftStorage.set({
                ...leftStorage.get()!,
                templates: leftStorage
                    .get()!
                    .templates.map((template) =>
                        template.id === 'shared-template' ? { ...template, name: 'Collaborative rename' } : template
                    ),
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            rightStorage.hydrate?.();
            rightStorage.set({
                ...rightStorage.get()!,
                assignments: [
                    {
                        consumerType: 'clip',
                        consumerId: 'assigned-clip',
                        templateId: 'shared-template',
                        amount: 0.8,
                    },
                ],
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction });
            expect(mergedState.templates.find((template) => template.id === 'shared-template')?.name).toBe(
                'Collaborative rename'
            );
            expect(mergedState.assignments).toContainEqual({
                consumerType: 'clip',
                consumerId: 'assigned-clip',
                templateId: 'shared-template',
                amount: 0.8,
            });
        }
    );

    it.each(['left-right', 'right-left'] as const)(
        'resolves two concurrent renames of the same template on content, not arrival order $0',
        (direction) => {
            const legacyBaseline = from<RootDocument>({
                grooveTemplates: {
                    templates: [...createBuiltinGrooveTemplates(), createTemplate('contested-template')],
                    assignments: [],
                },
            });
            // The peer whose conflict entry is handed to the resolver first holds
            // the name that loses the content tiebreak, so an arrival-order winner
            // and a content winner are different values.
            const leftPeer = createPeer(clone(legacyBaseline, FIRST_SEEN_ACTOR_ID));
            const rightPeer = createPeer(clone(legacyBaseline, LAST_SEEN_ACTOR_ID));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            expect(leftStorage.hydrate?.()).toBe(true);
            leftStorage.set({
                ...leftStorage.get()!,
                templates: leftStorage
                    .get()!
                    .templates.map((template) =>
                        template.id === 'contested-template' ? { ...template, name: 'Alpha rename' } : template
                    ),
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            expect(rightStorage.hydrate?.()).toBe(true);
            rightStorage.set({
                ...rightStorage.get()!,
                templates: rightStorage
                    .get()!
                    .templates.map((template) =>
                        template.id === 'contested-template' ? { ...template, name: 'Zulu rename' } : template
                    ),
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction });
            expect(mergedState.templates.find((template) => template.id === 'contested-template')?.name).toBe(
                'Zulu rename'
            );
        }
    );

    it.each(['left-right', 'right-left'] as const)(
        'keeps a deletion ahead of a concurrent rename of the same template $0',
        (direction) => {
            const legacyBaseline = from<RootDocument>({
                grooveTemplates: {
                    templates: [...createBuiltinGrooveTemplates(), createTemplate('contested-deleted-template')],
                    assignments: [],
                },
            });
            const leftPeer = createPeer(clone(legacyBaseline, FIRST_SEEN_ACTOR_ID));
            const rightPeer = createPeer(clone(legacyBaseline, LAST_SEEN_ACTOR_ID));
            const leftStorage = createGrooveTemplateAutomergeStorage();
            const rightStorage = createGrooveTemplateAutomergeStorage();

            configureAutomergeStoragePort(leftPeer.port);
            expect(leftStorage.hydrate?.()).toBe(true);
            leftStorage.set({
                ...leftStorage.get()!,
                templates: leftStorage
                    .get()!
                    .templates.filter((template) => template.id !== 'contested-deleted-template'),
            });
            flushAutomergeStorageWrites();

            configureAutomergeStoragePort(rightPeer.port);
            expect(rightStorage.hydrate?.()).toBe(true);
            rightStorage.set({
                ...rightStorage.get()!,
                templates: rightStorage
                    .get()!
                    .templates.map((template) =>
                        template.id === 'contested-deleted-template' ? { ...template, name: 'Zulu rename' } : template
                    ),
            });
            flushAutomergeStorageWrites();

            const mergedState = mergePeers({ leftPeer, rightPeer, direction });
            expect(mergedState.templates.some((template) => template.id === 'contested-deleted-template')).toBe(false);
        }
    );
});
