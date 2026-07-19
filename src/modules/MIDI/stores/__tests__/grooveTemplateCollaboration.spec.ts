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

type RootDocument = { grooveTemplates: GrooveTemplateState };
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

describe('groove template collaboration storage', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it.each(['left-right', 'right-left'] as const)(
        'reconciles concurrent templates and assignments when merged $0',
        (mergeDirection) => {
            const baseline = from<RootDocument>({
                grooveTemplates: { templates: createBuiltinGrooveTemplates(), assignments: [] },
            });
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

            const merged =
                mergeDirection === 'left-right'
                    ? merge(leftPeer.getDoc(), rightPeer.getDoc())
                    : merge(rightPeer.getDoc(), leftPeer.getDoc());
            const mergedPeer = createPeer(merged);
            const mergedStorage = createGrooveTemplateAutomergeStorage();
            configureAutomergeStoragePort(mergedPeer.port);

            expect(mergedStorage.hydrate?.()).toBe(true);
            expect(mergedStorage.get()?.templates).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'left-template' }),
                    expect.objectContaining({ id: 'right-template' }),
                ])
            );
            expect(mergedStorage.get()?.assignments).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ consumerId: 'left-consumer', templateId: 'left-template' }),
                    expect.objectContaining({ consumerId: 'right-consumer', templateId: 'right-template' }),
                ])
            );
        }
    );
});
