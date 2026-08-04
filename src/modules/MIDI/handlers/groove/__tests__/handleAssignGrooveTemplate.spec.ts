import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/grooveTemplates/assignGrooveTemplate', () => ({
    assignGrooveTemplate: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment', () => ({
    canonicalizeGrooveTemplateAssignment: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplates/getGrooveAssignment', () => ({
    getGrooveAssignment: vi.fn(),
}));

import { assignGrooveTemplate } from '../../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { getGrooveAssignment } from '../../../useCases/grooveTemplates/getGrooveAssignment';
import { handleAssignGrooveTemplate } from '../handleAssignGrooveTemplate';

const mockedAssign = vi.mocked(assignGrooveTemplate);
const mockedCanonicalize = vi.mocked(canonicalizeGrooveTemplateAssignment);
const mockedGetAssignment = vi.mocked(getGrooveAssignment);

const payload = { consumerType: 'clip' as const, consumerId: 'c1', templateId: 'g1', amount: 1 };
const action = { type: 'assignGrooveTemplate' as const, payload };

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleAssignGrooveTemplate — execute', () => {
    it('calls assignGrooveTemplate with payload', () => {
        mockedAssign.mockReturnValue({ ok: true } as never);
        handleAssignGrooveTemplate.execute(action);
        expect(mockedAssign).toHaveBeenCalledWith(payload);
    });

    it('throws when assignment rejected', () => {
        mockedAssign.mockReturnValue({ ok: false, error: { code: 'bad' } } as never);
        expect(() => handleAssignGrooveTemplate.execute(action)).toThrow(/Groove assignment rejected/);
    });
});

describe('handleAssignGrooveTemplate — isNoop', () => {
    it('returns true when canonical matches current', () => {
        const assignment = { consumerType: 'clip', consumerId: 'c1', templateId: 'g1', amount: 1 };
        mockedCanonicalize.mockReturnValue(assignment as never);
        mockedGetAssignment.mockReturnValue(assignment as never);
        expect(handleAssignGrooveTemplate.isNoop!(action)).toBe(true);
    });

    it('returns false when canonical is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        mockedGetAssignment.mockReturnValue(undefined);
        expect(handleAssignGrooveTemplate.isNoop!(action)).toBe(false);
    });
});

describe('handleAssignGrooveTemplate — describe', () => {
    it('returns label and inverse restoreGrooveAssignment', () => {
        mockedCanonicalize.mockReturnValue({
            consumerType: 'clip',
            consumerId: 'c1',
            templateId: 'g1',
            amount: 1,
        } as never);
        mockedGetAssignment.mockReturnValue(undefined);
        const result = handleAssignGrooveTemplate.describe(action);
        expect(result.label).toBe('Assign groove template');
        expect(result.inverseAction?.type).toBe('restoreGrooveAssignment');
    });

    it('returns null inverse when canonical is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        const result = handleAssignGrooveTemplate.describe(action);
        expect(result.inverseAction).toBeNull();
    });
});
