import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createBuiltinGrooveTemplates } from '../../models/BuiltinGrooveTemplates';
import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { createGrooveTemplateAutomergeStorage } from '../grooveTemplateAutomergeStorage';
import { type GrooveTemplateState } from '../grooveTemplateStore';

type RootDocument = { grooveTemplates?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

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

function createPeer(initialDoc: Doc<RootDocument>): { getDoc: () => Doc<RootDocument>; port: TestPort } {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
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
});
