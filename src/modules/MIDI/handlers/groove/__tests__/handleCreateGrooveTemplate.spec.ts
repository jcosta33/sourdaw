import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../models/GrooveTemplate', () => ({
    canonicalizeGrooveTemplateId: vi.fn((id: string) => id.trim() || null),
}));

vi.mock('../../../useCases/grooveTemplates/createGrooveTemplate', () => ({
    createGrooveTemplate: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplates/getGrooveTemplate', () => ({
    getGrooveTemplate: vi.fn(),
}));

import { canonicalizeGrooveTemplateId } from '../../../models/GrooveTemplate';
import { createGrooveTemplate } from '../../../useCases/grooveTemplates/createGrooveTemplate';
import { getGrooveTemplate } from '../../../useCases/grooveTemplates/getGrooveTemplate';
import { markGrooveTemplateProjectWrite } from '../../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { handleCreateGrooveTemplate } from '../handleCreateGrooveTemplate';

const mockedCanonicalize = vi.mocked(canonicalizeGrooveTemplateId);
const mockedCreate = vi.mocked(createGrooveTemplate);
const mockedGet = vi.mocked(getGrooveTemplate);

const template = {
    id: 'g1',
    name: 'Funk',
    schemaVersion: 1 as const,
    subdivision: '1/16' as const,
    slots: [],
    provenance: { type: 'user' as const, sourceId: 'manual' },
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleCreateGrooveTemplate — execute', () => {
    it('calls createGrooveTemplate with canonicalized id', () => {
        mockedCanonicalize.mockReturnValue('g1');
        mockedCreate.mockReturnValue({ status: 'written', template });
        const result = handleCreateGrooveTemplate.execute({
            type: 'createGrooveTemplate',
            payload: {
                id: 'g1',
                name: 'Funk',
                subdivision: '1/16',
                slots: [],
                provenance: template.provenance,
            },
        });
        expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', name: 'Funk' }));
        expect(result).toEqual({
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        });
    });

    it('throws when canonicalized id is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        expect(() =>
            handleCreateGrooveTemplate.execute({
                type: 'createGrooveTemplate',
                payload: { id: '  ', name: 'X', subdivision: '1/16', slots: [], provenance: template.provenance },
            })
        ).toThrow('Groove template ID must be nonempty');
    });
});

describe('handleCreateGrooveTemplate — describe', () => {
    it('returns label with template name and inverse deleteGrooveTemplate when not existing', () => {
        mockedCanonicalize.mockReturnValue('g1');
        mockedGet.mockReturnValue(undefined);
        const result = handleCreateGrooveTemplate.describe({
            type: 'createGrooveTemplate',
            payload: { id: 'g1', name: 'Funk', subdivision: '1/16', slots: [], provenance: template.provenance },
        });
        expect(result.label).toBe('Create groove template "Funk"');
        expect(result.inverseAction?.type).toBe('deleteGrooveTemplate');
        expect((result.inverseAction as { payload: { templateId: string } }).payload.templateId).toBe('g1');
    });

    it('returns null inverse when template already exists', () => {
        mockedCanonicalize.mockReturnValue('g1');
        mockedGet.mockReturnValue(template);
        const result = handleCreateGrooveTemplate.describe({
            type: 'createGrooveTemplate',
            payload: { id: 'g1', name: 'Funk', subdivision: '1/16', slots: [], provenance: template.provenance },
        });
        expect(result.inverseAction).toBeNull();
    });

    it('throws when canonicalized id is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        expect(() =>
            handleCreateGrooveTemplate.describe({
                type: 'createGrooveTemplate',
                payload: { id: '', name: 'X', subdivision: '1/16', slots: [], provenance: template.provenance },
            })
        ).toThrow('Groove template ID must be nonempty');
    });
});
