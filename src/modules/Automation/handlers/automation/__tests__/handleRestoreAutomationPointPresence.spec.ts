import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { restoreAutomationPointPresence } from '../../../useCases/automation/restoreAutomationPointPresence';
import { getAutomationStoreState } from '../../../useCases/getAutomationStoreState';
import { handleRestoreAutomationPointPresence } from '../handleRestoreAutomationPointPresence';

vi.mock('../../../useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));

vi.mock('../../../useCases/automation/restoreAutomationPointPresence', () => ({
    restoreAutomationPointPresence: vi.fn(),
}));

const point: AutomationPoint = { id: 'point-1', beat: 4, value: 0.9, curve: 'linear', tension: 0 };

function lane(overrides: Partial<AutomationLane> = {}): AutomationLane {
    return {
        id: 'lane-follower',
        trackId: 'track-follower',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        linkedLaneId: 'lane-source',
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

type ReplayPayload = Extract<AppAction, { type: 'restoreAutomationPointPresence' }>['payload'];

function payload(overrides: Partial<ReplayPayload> = {}): ReplayPayload {
    return {
        laneId: 'lane-follower',
        owner: {
            trackId: 'track-follower',
            parameterId: 'gain',
            linkedLaneId: 'lane-source',
        },
        point,
        equalBeatIndex: 0,
        expectedPresence: 'absent',
        replacementPresence: 'present',
        ...overrides,
    };
}

const mockedGetState = vi.mocked(getAutomationStoreState);
const mockedRestore = vi.mocked(restoreAutomationPointPresence);

beforeEach(() => {
    vi.clearAllMocks();
    mockedGetState.mockReturnValue({ lanes: [lane()] });
});

describe('handleRestoreAutomationPointPresence', () => {
    it.each([
        ['an unsupported curve', payload({ point: { ...point, curve: 'warp-drive' } })],
        ['an extra payload field', payload({ extra: 'smuggled' })],
    ])('rejects persisted arguments with %s without mutating', (_label, malformedPayload) => {
        expect(handleRestoreAutomationPointPresence.validateSessionActionArguments?.(malformedPayload)).toBe(false);
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('rejects an incompatible lane owner without mutating', () => {
        const result = handleRestoreAutomationPointPresence.execute({
            type: 'restoreAutomationPointPresence',
            payload: payload({
                owner: { trackId: 'other-track', parameterId: 'gain', linkedLaneId: 'lane-source' },
            }),
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedRestore).not.toHaveBeenCalled();
    });

    it('rejects a changed point with the captured id without mutating', () => {
        mockedGetState.mockReturnValue({ lanes: [lane({ points: [{ ...point, value: 0.4 }] })] });

        const result = handleRestoreAutomationPointPresence.execute({
            type: 'restoreAutomationPointPresence',
            payload: payload({ expectedPresence: 'present', replacementPresence: 'absent' }),
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mockedRestore).not.toHaveBeenCalled();
    });
});
