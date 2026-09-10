import { describe, expect, it } from 'vitest';

import { type CreativeInterpretationCatalog } from '../../models/CreativeInterpretation';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';

const REVISION = 'revision-7';
const CATALOG_ID = 'creative-0123456789abcdef';

const catalog: CreativeInterpretationCatalog = {
    schemaVersion: 1,
    catalogId: CATALOG_ID,
    revision: REVISION,
    requestDigest: 'digest-of-the-request',
    selection: { trackId: 'track-lead', clipId: null, clipIds: [], activeView: 'arrange' },
    unresolvedExplicitReferences: [],
    modes: ['edit', 'create', 'read-only'],
    targets: [
        {
            candidateId: 'target-1',
            provenance: 'explicit-reference',
            objectType: 'track',
            objectIds: ['track-lead'],
            parentTrackId: null,
            label: 'Lead Vocals',
        },
    ],
    dimensions: [
        { candidateId: 'dimension-processing', dimension: 'processing' },
        { candidateId: 'dimension-midi-content', dimension: 'midi-content' },
        { candidateId: 'dimension-arrangement', dimension: 'arrangement' },
    ],
    constraints: [
        { candidateId: 'constraint-1', kind: 'exclude-dimension', dimension: 'processing' },
        { candidateId: 'constraint-2', kind: 'exclude-dimension', dimension: 'midi-content' },
        { candidateId: 'constraint-3', kind: 'exclude-dimension', dimension: 'arrangement' },
        { candidateId: 'constraint-4', kind: 'protect-object', objectId: 'track-lead', label: 'Lead Vocals' },
    ],
    creationSlots: [
        { candidateId: 'slot-1', objectType: 'track', parentCandidateId: null, budget: 4 },
        { candidateId: 'slot-2', objectType: 'clip', parentCandidateId: 'target-1', budget: 8 },
    ],
};

function createCall(overrides: Record<string, unknown> = {}): ToolCallResult {
    return {
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId: CATALOG_ID,
            modeId: 'edit',
            targetCandidateIds: ['target-1'],
            editDimensionCandidateIds: ['dimension-processing'],
            constraintCandidateIds: [],
            creationSlotIds: [],
            uncertainty: 'none',
            ...overrides,
        },
    };
}

function admit(
    call: ToolCallResult,
    input: { catalog?: CreativeInterpretationCatalog; projectRevision?: string } = {}
) {
    return admitCreativeInterpretation({
        catalog: input.catalog ?? catalog,
        call,
        projectRevision: input.projectRevision ?? REVISION,
    });
}

describe('admitCreativeInterpretation', () => {
    it('refuses arguments that are not the published shape', () => {
        const missingKey = createCall();
        delete missingKey.arguments.uncertainty;

        expect(admit(missingKey)).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation arguments do not match the published schema.',
        });
        expect(admit(createCall({ targetCandidateIds: 'target-1' }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation arguments do not match the published schema.',
        });
    });

    it('refuses a catalog id or revision that is not the one it published', () => {
        expect(admit(createCall({ catalogId: 'creative-ffffffffffffffff' }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation refers to a stale or unknown catalog.',
        });
        expect(admit(createCall(), { projectRevision: 'revision-8' })).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation refers to a stale or unknown catalog.',
        });
    });

    it('refuses an unpublished candidate id and a repeated one alike', () => {
        expect(admit(createCall({ targetCandidateIds: ['target-9'] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation selected an unknown or duplicate candidate.',
        });
        expect(admit(createCall({ targetCandidateIds: ['target-1', 'target-1'] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation selected an unknown or duplicate candidate.',
        });
    });

    it('refuses a mode the catalog did not offer', () => {
        expect(admit(createCall({ modeId: 'unresolved' }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation selected an unavailable request mode.',
        });
    });

    it('refuses a read-only interpretation that still selects work', () => {
        expect(admit(createCall({ modeId: 'read-only' }))).toEqual({
            status: 'rejected',
            reason: 'A read-only interpretation cannot select edits or targets.',
        });
    });

    it('refuses a mode whose required selections are absent', () => {
        expect(admit(createCall({ targetCandidateIds: [], editDimensionCandidateIds: [] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation is missing a target, dimension, or creation slot for its mode.',
        });
        expect(admit(createCall({ modeId: 'create', targetCandidateIds: [], editDimensionCandidateIds: [] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation is missing a target, dimension, or creation slot for its mode.',
        });
    });

    it('refuses a contextual target while the request named an object', () => {
        const withBoth: CreativeInterpretationCatalog = {
            ...catalog,
            targets: [
                ...catalog.targets,
                {
                    candidateId: 'target-2',
                    provenance: 'contextual-selection',
                    objectType: 'track',
                    objectIds: ['track-bass'],
                    parentTrackId: null,
                    label: 'Bass',
                },
            ],
        };

        expect(admit(createCall({ targetCandidateIds: ['target-2'] }), { catalog: withBoth })).toEqual({
            status: 'rejected',
            reason: 'Explicit request references cannot be replaced by contextual selection.',
        });
    });

    it('refuses one dimension that is both selected and excluded', () => {
        expect(admit(createCall({ constraintCandidateIds: ['constraint-1'] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation both selects and excludes one edit dimension.',
        });
    });

    it('refuses a target the same interpretation asked to protect', () => {
        expect(admit(createCall({ constraintCandidateIds: ['constraint-4'] }))).toEqual({
            status: 'rejected',
            reason: 'Creative interpretation targets a protected object.',
        });
    });

    it('refuses a creation slot whose parent target was not selected', () => {
        expect(
            admit(
                createCall({
                    modeId: 'create',
                    targetCandidateIds: [],
                    editDimensionCandidateIds: [],
                    creationSlotIds: ['slot-2'],
                })
            )
        ).toEqual({
            status: 'rejected',
            reason: 'Creative creation slot is not attached to a selected target.',
        });
    });

    it('mints an authority recording exactly what an admitted edit delegated', () => {
        const admission = admit(
            createCall({
                editDimensionCandidateIds: ['dimension-processing', 'dimension-arrangement'],
                constraintCandidateIds: ['constraint-2'],
                creationSlotIds: ['slot-2'],
                uncertainty: 'artistic',
            })
        );

        expect(admission.status).toBe('admitted');
        if (admission.status !== 'admitted') {
            return;
        }
        const { authorityId, ...record } = admission.authority;
        expect(authorityId).toMatch(/^creative-authority-[0-9a-f-]{36}$/u);
        expect(record).toEqual({
            schemaVersion: 1,
            catalogId: CATALOG_ID,
            requestDigest: 'digest-of-the-request',
            revision: REVISION,
            selection: { trackId: 'track-lead', clipId: null, clipIds: [], activeView: 'arrange' },
            mode: 'edit',
            targets: [
                {
                    provenance: 'explicit-reference',
                    objectType: 'track',
                    objectIds: ['track-lead'],
                    parentTrackId: null,
                },
            ],
            editDimensions: ['processing', 'arrangement'],
            prohibitions: [{ kind: 'exclude-dimension', dimension: 'midi-content' }],
            creationSlots: [{ objectType: 'clip', parentObjectId: 'track-lead', budget: 8 }],
            uncertainty: 'artistic',
        });
    });

    it('mints an empty-handed authority for an admitted read-only interpretation', () => {
        const admission = admit(
            createCall({ modeId: 'read-only', targetCandidateIds: [], editDimensionCandidateIds: [] })
        );

        expect(admission.status).toBe('admitted');
        if (admission.status !== 'admitted') {
            return;
        }
        expect(admission.authority.mode).toBe('read-only');
        expect(admission.authority.targets).toEqual([]);
        expect(admission.authority.editDimensions).toEqual([]);
        expect(admission.authority.prohibitions).toEqual([]);
        expect(admission.authority.creationSlots).toEqual([]);
        expect(admission.authority.uncertainty).toBe('none');
    });

    it('asks rather than records when the interpretation doubts its own authority', () => {
        expect(admit(createCall({ uncertainty: 'authority' }))).toEqual({
            status: 'clarify',
            reason: 'The request does not identify which objects or edit dimensions it delegates.',
        });
    });

    it('asks when the catalog resolved no object the request named', () => {
        const unresolved: CreativeInterpretationCatalog = {
            ...catalog,
            unresolvedExplicitReferences: ['Horn Section'],
            modes: ['unresolved'],
            targets: [],
        };

        expect(
            admit(createCall({ modeId: 'unresolved', targetCandidateIds: [], editDimensionCandidateIds: [] }), {
                catalog: unresolved,
            })
        ).toEqual({
            status: 'clarify',
            reason: 'The request does not identify which objects or edit dimensions it delegates.',
        });
    });
});
