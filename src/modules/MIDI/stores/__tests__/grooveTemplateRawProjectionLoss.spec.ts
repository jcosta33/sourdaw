import { beforeEach, describe, expect, it } from 'vitest';

import { findAutomergeStorageRawProjectionLosses } from '#/infra/store/storage/createAutomergeStorage';

import { createBuiltinGrooveTemplates } from '../../models/BuiltinGrooveTemplates';
import { sanitizeGrooveTemplateState } from '../../models/GrooveTemplateState';
import { createGrooveTemplateAutomergeStorage } from '../grooveTemplateAutomergeStorage';

/**
 * `grooveTemplates` opts out of raw projection-loss detection only where the
 * adapter's own entity-map encoding is what the slot actually holds. The
 * encoding is adopted when the slot is next written, so a document last saved
 * by a build predating it still carries the legacy array shape, `decodeState`
 * still accepts that shape, and a template row the sanitizer drops there is
 * real loss the next save would make permanent.
 */
function registerGrooveSanitizer(): void {
    createGrooveTemplateAutomergeStorage().registerInboundSanitizer?.(sanitizeGrooveTemplateState);
}

function legacyTemplateRows(): unknown[] {
    return structuredClone(createBuiltinGrooveTemplates());
}

function findLosses(grooveTemplates: unknown): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: { grooveTemplates } });
}

describe('groove template raw projection losses', () => {
    beforeEach(() => {
        registerGrooveSanitizer();
    });

    it('reports no loss for a slot written in the adapter entity-map encoding', () => {
        expect(findLosses({ schemaVersion: 1, templates: {}, assignments: {} })).toEqual([]);
    });

    it('reports no loss for a legacy-shaped slot the sanitizer preserves', () => {
        expect(findLosses({ templates: legacyTemplateRows(), assignments: [] })).toEqual([]);
    });

    it('reports a loss for a legacy-shaped slot holding a template row the sanitizer drops', () => {
        expect(
            findLosses({
                templates: [...legacyTemplateRows(), { id: 'groove-broken', name: 'Broken' }],
                assignments: [],
            })
        ).toEqual(['grooveTemplates']);
    });
});
