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
import { handleApplyGroove } from '../handleApplyGroove';

const mockedAssign = vi.mocked(assignGrooveTemplate);
const mockedCanonicalize = vi.mocked(canonicalizeGrooveTemplateAssignment);
const mockedGetAssignment = vi.mocked(getGrooveAssignment);

const baseAction = {
    type: 'applyGroove' as const,
    payload: { clipId: 'c1', grooveId: 'g1', amount: 0.8 },
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleApplyGroove — execute', () => {
    it('calls assignGrooveTemplate with the correct input', () => {
        mockedAssign.mockReturnValue({ ok: true } as never);
        handleApplyGroove.execute(baseAction);
        expect(mockedAssign).toHaveBeenCalledTimes(1);
        const arg = mockedAssign.mock.calls[0]?.[0];
        expect(arg).toEqual({ consumerType: 'clip', consumerId: 'c1', templateId: 'g1', amount: 0.8 });
    });

    it('throws when assignment is rejected', () => {
        mockedAssign.mockReturnValue({ ok: false, error: { code: 'invalid-template' } } as never);
        expect(() => handleApplyGroove.execute(baseAction)).toThrow(/Groove assignment rejected/);
    });

    it('defaults amount to 1 when not provided', () => {
        mockedAssign.mockReturnValue({ ok: true } as never);
        handleApplyGroove.execute({ type: 'applyGroove', payload: { clipId: 'c1', grooveId: 'g1' } });
        const arg = mockedAssign.mock.calls[0]?.[0];
        expect(arg?.amount).toBe(1);
    });
});

describe('handleApplyGroove — isNoop', () => {
    it('returns true when canonical matches current', () => {
        const assignment = { consumerType: 'clip', consumerId: 'c1', templateId: 'g1', amount: 0.8 };
        mockedCanonicalize.mockReturnValue(assignment as never);
        mockedGetAssignment.mockReturnValue(assignment as never);
        expect(handleApplyGroove.isNoop!(baseAction)).toBe(true);
    });

    it('returns false when canonical is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        mockedGetAssignment.mockReturnValue(undefined);
        expect(handleApplyGroove.isNoop!(baseAction)).toBe(false);
    });

    it('returns false when current differs from canonical', () => {
        mockedCanonicalize.mockReturnValue({
            consumerType: 'clip',
            consumerId: 'c1',
            templateId: 'g1',
            amount: 0.8,
        } as never);
        mockedGetAssignment.mockReturnValue({
            consumerType: 'clip',
            consumerId: 'c1',
            templateId: 'g2',
            amount: 0.5,
        } as never);
        expect(handleApplyGroove.isNoop!(baseAction)).toBe(false);
    });
});

describe('handleApplyGroove — describe', () => {
    it('returns label with groove id', () => {
        mockedCanonicalize.mockReturnValue({
            consumerType: 'clip',
            consumerId: 'c1',
            templateId: 'g1',
            amount: 0.8,
        } as never);
        mockedGetAssignment.mockReturnValue(undefined);
        const result = handleApplyGroove.describe(baseAction);
        expect(result.label).toBe('Assign groove "g1"');
    });

    it('returns inverse restoreGrooveAssignment when canonical is valid', () => {
        mockedCanonicalize.mockReturnValue({
            consumerType: 'clip',
            consumerId: 'c1',
            templateId: 'g1',
            amount: 0.8,
        } as never);
        mockedGetAssignment.mockReturnValue(undefined);
        const result = handleApplyGroove.describe(baseAction);
        expect(result.inverseAction?.type).toBe('restoreGrooveAssignment');
        const payload = (
            result.inverseAction as {
                payload: { consumerType: string; consumerId: string; assignment: unknown; expectedAssignment: unknown };
            }
        ).payload;
        expect(payload.consumerType).toBe('clip');
        expect(payload.consumerId).toBe('c1');
    });

    it('returns null inverse when canonical is null', () => {
        mockedCanonicalize.mockReturnValue(null);
        const result = handleApplyGroove.describe(baseAction);
        expect(result.inverseAction).toBeNull();
    });
});
