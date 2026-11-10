import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutomationPoint } from '../../../models/Automation';
import { type AutomationStoreState } from '../../../stores/automationStore';
import * as subject from '../updateAutomationPoint';

const mocks = vi.hoisted(() => ({
    state: { value: { lanes: [] } } as { value: AutomationStoreState | null },
    set: vi.fn(),
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

const lane = (points: AutomationPoint[]): AutomationStoreState => ({
    lanes: [
        {
            id: 'lane',
            trackId: 'track',
            parameterId: 'gain',
            parameterName: 'Gain',
            points,
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 2,
        },
    ],
});

describe('updateAutomationPoint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
        mocks.set.mockImplementation((next: AutomationStoreState) => {
            mocks.state.value = next;
        });
    });

    it('should export updateAutomationPoint', () => {
        expect(subject.updateAutomationPoint).toBeDefined();
        const time = typeof subject.updateAutomationPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it.each([
        { targetBeat: 5, neighborBeat: 5.02 },
        { targetBeat: 5.02, neighborBeat: 5 },
    ])(
        'moves the exact point at $targetBeat without changing its nearby neighbor at $neighborBeat',
        ({ targetBeat, neighborBeat }) => {
            const target: AutomationPoint = {
                id: 'target',
                beat: targetBeat,
                value: 0.3,
                curve: 'linear',
                tension: 0.2,
            };
            const neighbor: AutomationPoint = {
                id: 'neighbor',
                beat: neighborBeat,
                value: 0.8,
                curve: 'smooth',
                tension: -0.4,
            };
            const initial = lane([target, neighbor].sort((a, b) => a.beat - b.beat));
            mocks.state.value = initial;
            subject.updateAutomationPoint('lane', targetBeat, 0.6, 6, 'target');
            expect(mocks.set).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(lane([neighbor, { ...target, beat: 6, value: 0.6 }]));
        }
    );

    it('keeps the unique nearby-beat fallback for a pixel-rounded input', () => {
        const point: AutomationPoint = { id: 'only', beat: 5, value: 0.2, curve: 'linear', tension: 0.1 };
        mocks.state.value = lane([point]);
        expect(subject.updateAutomationPoint('lane', 5.02, 0.9)).toBe(true);
        expect(mocks.set).toHaveBeenCalledOnce();
        expect(mocks.set).toHaveBeenCalledWith(lane([{ ...point, value: 0.9 }]));
    });
    it('moves one same-beat identified point across neighbors without losing metadata or mutating input', () => {
        const target: AutomationPoint = {
            id: 'target',
            beat: 5,
            value: 0.3,
            curve: 'bezier',
            tension: 0.2,
            cp1: { x: 0.2, y: 0.7 },
            cp2: { x: 0.8, y: 0.9 },
            stairSteps: 8,
        };
        const neighbor: AutomationPoint = { id: 'neighbor', beat: 5, value: 0.8, curve: 'step', tension: -0.4 };
        const initial = lane([neighbor, target]);
        const before = structuredClone(initial);
        mocks.state.value = initial;
        subject.updateAutomationPoint('lane', 5, 0.6, 4, 'target');
        expect(mocks.set).toHaveBeenCalledWith(lane([{ ...target, beat: 4, value: 0.6 }, neighbor]));
        expect(initial).toEqual(before);
    });

    it.each(['missing', ''])('never falls back to beat when explicit ID %s is missing', (id) => {
        mocks.state.value = lane([{ id: 'neighbor', beat: 5, value: 0.8, curve: 'linear', tension: 0 }]);
        subject.updateAutomationPoint('lane', 5, 0.6, 6, id);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('refuses duplicate IDs even when only one is near the input beat', () => {
        mocks.state.value = lane([
            { id: 'target', beat: 5, value: 0.3, curve: 'linear', tension: 0 },
            { id: 'target', beat: 9, value: 0.8, curve: 'step', tension: 0 },
        ]);
        subject.updateAutomationPoint('lane', 5, 0.6, 6, 'target');
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('retains a unique ID-less point and refuses ambiguous legacy candidates', () => {
        const point: AutomationPoint = { beat: 5, value: 0.3, curve: 'linear', tension: 0.2 };
        mocks.state.value = lane([point]);
        subject.updateAutomationPoint('lane', 5.02, 0.6, 6);
        expect(mocks.set).toHaveBeenCalledWith(lane([{ ...point, beat: 6, value: 0.6 }]));
        mocks.set.mockClear();
        mocks.state.value = lane([point, { ...point, beat: 5.02, value: 0.8 }]);
        subject.updateAutomationPoint('lane', 5, 0.6, 6);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does not write for a missing lane or a removed target', () => {
        mocks.state.value = lane([]);
        subject.updateAutomationPoint('missing', 5, 0.6, 6);
        subject.updateAutomationPoint('lane', 5, 0.6, 6);
        expect(mocks.set).not.toHaveBeenCalled();
    });
    it('refuses an unsafe ID-less destination before writing, then admits and restores a clear move', () => {
        const target: AutomationPoint = {
            beat: 2,
            value: 0.3,
            curve: 'bezier',
            tension: 0.2,
            cp1: { x: 0.2, y: 0.7 },
            cp2: { x: 0.8, y: 0.9 },
            stairSteps: 8,
        };
        const neighbor: AutomationPoint = { beat: 4.02, value: 0.8, curve: 'step', tension: -0.4 };
        const initial = lane([target, neighbor]);
        const original = structuredClone(initial);
        mocks.state.value = initial;
        expect(subject.updateAutomationPoint('lane', 2, 0.6, 4)).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toEqual(original);
        expect(subject.updateAutomationPoint('lane', 2, 0.6, 5)).toBe(true);
        expect(mocks.state.value).toEqual(lane([neighbor, { ...target, beat: 5, value: 0.6 }]));
        expect(subject.updateAutomationPoint('lane', 5, 0.3, 2)).toBe(true);
        expect(mocks.state.value).toEqual(original);
        expect(initial).toEqual(original);
    });

    it('keeps the last accepted legacy pose after a later refused move and restores from it', () => {
        const target: AutomationPoint = { beat: 2, value: 0.3, curve: 'linear', tension: 0.2 };
        const neighbor: AutomationPoint = { beat: 4.02, value: 0.8, curve: 'step', tension: -0.4 };
        const initial = lane([target, neighbor]);
        mocks.state.value = initial;
        expect(subject.updateAutomationPoint('lane', 2, 0.6, 3.5)).toBe(true);
        const accepted = lane([{ ...target, beat: 3.5, value: 0.6 }, neighbor]);
        expect(mocks.state.value).toEqual(accepted);
        mocks.set.mockClear();
        expect(subject.updateAutomationPoint('lane', 3.5, 0.7, 4)).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toEqual(accepted);
        expect(subject.updateAutomationPoint('lane', 3.5, 0.3, 2)).toBe(true);
        expect(mocks.state.value).toEqual(initial);
    });

    it('refuses a same-beat legacy destination while allowing an identified point to share it', () => {
        const target: AutomationPoint = { id: 'target', beat: 2, value: 0.3, curve: 'linear', tension: 0.2 };
        const neighbor: AutomationPoint = { id: 'neighbor', beat: 4, value: 0.8, curve: 'step', tension: -0.4 };
        const initial = lane([target, neighbor]);
        mocks.state.value = initial;
        expect(subject.updateAutomationPoint('lane', 2, 0.6, 4)).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toEqual(initial);
        expect(subject.updateAutomationPoint('lane', 2, 0.6, 4, 'target')).toBe(true);
        expect(mocks.state.value).toEqual(lane([{ ...target, beat: 4, value: 0.6 }, neighbor]));
        expect(subject.updateAutomationPoint('lane', 4, 0.3, 2, 'target')).toBe(true);
        expect(mocks.state.value).toEqual(initial);
    });
});
