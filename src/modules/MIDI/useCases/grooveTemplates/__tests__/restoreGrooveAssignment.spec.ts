import { describe, expect, it, vi, beforeEach } from 'vitest';

import { defaultGrooveTemplateState, type GrooveTemplateAssignment } from '#/modules/MIDI/models/GrooveTemplateState';

const { mockStore, mockMarkWrite, mockIsAssignment } = vi.hoisted(() => ({
    mockStore: {
        value: null as typeof defaultGrooveTemplateState | null,
        set: vi.fn((state: typeof defaultGrooveTemplateState) => {
            mockStore.value = state;
        }),
    },
    mockMarkWrite: vi.fn(),
    mockIsAssignment: vi.fn((value: unknown) => {
        const v = value as Record<string, unknown>;
        return (
            typeof v.consumerType === 'string' &&
            typeof v.consumerId === 'string' &&
            typeof v.templateId === 'string' &&
            typeof v.amount === 'number'
        );
    }),
}));

vi.mock('../../../stores/grooveTemplateStore', () => ({
    grooveTemplateStore: mockStore,
    isGrooveTemplateAssignment: mockIsAssignment,
}));
vi.mock('../markGrooveTemplateProjectWrite', () => ({ markGrooveTemplateProjectWrite: mockMarkWrite }));

import { restoreGrooveAssignment } from '../restoreGrooveAssignment';

function assignment(
    consumerType: string,
    consumerId: string,
    templateId: string,
    amount: number
): GrooveTemplateAssignment {
    return { consumerType: consumerType as GrooveTemplateAssignment['consumerType'], consumerId, templateId, amount };
}

describe('restoreGrooveAssignment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAssignment.mockImplementation((value: unknown) => {
            const v = value as Record<string, unknown>;
            return (
                typeof v.consumerType === 'string' &&
                typeof v.consumerId === 'string' &&
                typeof v.templateId === 'string' &&
                typeof v.amount === 'number'
            );
        });
        mockStore.value = {
            templates: [...defaultGrooveTemplateState.templates],
            assignments: [],
        };
    });

    it('returns early when store has no value', () => {
        mockStore.value = null;
        restoreGrooveAssignment({
            consumerType: 'clip',
            consumerId: 'clip-1',
            assignment: null,
        });
        expect(mockStore.set).not.toHaveBeenCalled();
    });

    it('removes the assignment when assignment is null', () => {
        mockStore.value = {
            templates: [...defaultGrooveTemplateState.templates],
            assignments: [assignment('clip', 'clip-1', 'groove-straight', 1)],
        };
        restoreGrooveAssignment({
            consumerType: 'clip',
            consumerId: 'clip-1',
            assignment: null,
        });
        expect(mockStore.set).toHaveBeenCalledTimes(1);
        expect(mockMarkWrite).toHaveBeenCalledTimes(1);
        const calls1 = mockStore.set.mock.calls as Array<Array<typeof defaultGrooveTemplateState>>;
        const state1 = calls1[0]?.[0];
        if (!state1) {
            throw new Error('Expected store.set');
        }
        expect(state1.assignments).toHaveLength(0);
    });

    it('adds a new assignment when none exists', () => {
        restoreGrooveAssignment({
            consumerType: 'clip',
            consumerId: 'clip-1',
            assignment: assignment('clip', 'clip-1', 'swing-light', 0.5),
        });
        expect(mockStore.set).toHaveBeenCalledTimes(1);
        const calls2 = mockStore.set.mock.calls as Array<Array<typeof defaultGrooveTemplateState>>;
        const state2 = calls2[0]?.[0];
        if (!state2) {
            throw new Error('Expected store.set');
        }
        expect(state2.assignments).toHaveLength(1);
        expect(state2.assignments[0]?.templateId).toBe('swing-light');
    });

    it('replaces an existing assignment', () => {
        mockStore.value = {
            templates: [...defaultGrooveTemplateState.templates],
            assignments: [assignment('clip', 'clip-1', 'groove-straight', 1)],
        };
        restoreGrooveAssignment({
            consumerType: 'clip',
            consumerId: 'clip-1',
            assignment: assignment('clip', 'clip-1', 'swing-heavy', 0.8),
        });
        const calls = mockStore.set.mock.calls as Array<Array<typeof defaultGrooveTemplateState>>;
        const state = calls[0]?.[0];
        if (!state) {
            throw new Error('Expected store.set to be called');
        }
        expect(state.assignments).toHaveLength(1);
        expect(state.assignments[0]?.templateId).toBe('swing-heavy');
    });

    it('throws when current assignment diverges from expectedAssignment', () => {
        mockStore.value = {
            templates: [...defaultGrooveTemplateState.templates],
            assignments: [assignment('clip', 'clip-1', 'groove-straight', 1)],
        };
        expect(() =>
            restoreGrooveAssignment({
                consumerType: 'clip',
                consumerId: 'clip-1',
                assignment: null,
                expectedAssignment: assignment('clip', 'clip-1', 'wrong-template', 0.5),
            })
        ).toThrow('diverged');
    });

    it('throws when assignment fails isGrooveTemplateAssignment validation', () => {
        mockIsAssignment.mockReturnValue(false);
        expect(() =>
            restoreGrooveAssignment({
                consumerType: 'clip',
                consumerId: 'clip-1',
                assignment: { consumerType: 'clip', consumerId: 'clip-1', templateId: '', amount: -1 },
            })
        ).toThrow('not canonical');
    });

    it('only affects the targeted consumer, leaving others untouched', () => {
        mockStore.value = {
            templates: [...defaultGrooveTemplateState.templates],
            assignments: [
                assignment('clip', 'clip-A', 'groove-straight', 1),
                assignment('clip', 'clip-B', 'swing-light', 0.5),
            ],
        };
        restoreGrooveAssignment({
            consumerType: 'clip',
            consumerId: 'clip-A',
            assignment: assignment('clip', 'clip-A', 'mpc-60', 0.7),
        });
        const calls = mockStore.set.mock.calls as Array<Array<typeof defaultGrooveTemplateState>>;
        const state = calls[0]?.[0];
        if (!state) {
            throw new Error('Expected store.set to be called');
        }
        expect(state.assignments).toHaveLength(2);
        expect(state.assignments.find((a) => a.consumerId === 'clip-B')?.templateId).toBe('swing-light');
    });
});
