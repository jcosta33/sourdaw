import { describe, expect, it } from 'vitest';

import { macroReplayRouteByActionType } from '../MacroReplayRoute';

describe('macroReplayRouteByActionType', () => {
    it.each([
        ['editTempoMap', { kind: 'tempo-map' }],
        ['restoreTempoMapEdit', { kind: 'tempo-map' }],
        [
            'insertAutomationLanePoints',
            { kind: 'refuse', reason: 'Automation lane insertions are local edits.', precedence: 0 },
        ],
        ['setLevainIdentity', { kind: 'refuse', reason: 'Levain identity changes are local edits.', precedence: 1 }],
        [
            'setToasterMasterGain',
            { kind: 'refuse', reason: 'Toaster Master gain edits target their original kit.', precedence: 2 },
        ],
        ['togglePlayback', { kind: 'replay' }],
    ] as const)('routes %s', (type, expected) => {
        expect(macroReplayRouteByActionType[type]).toEqual(expected);
    });

    it('routes every other action as recorded', () => {
        const special = new Set([
            'editTempoMap',
            'restoreTempoMapEdit',
            'insertAutomationLanePoints',
            'setLevainIdentity',
            'setToasterMasterGain',
        ]);
        const others = Object.entries(macroReplayRouteByActionType).filter(([type]) => !special.has(type));
        expect(others.length).toBeGreaterThan(300);
        expect(others.filter(([, route]) => route.kind !== 'replay')).toEqual([]);
    });

    it('does not read an inherited name as a route', () => {
        expect(Object.hasOwn(macroReplayRouteByActionType, 'constructor')).toBe(false);
    });
});
