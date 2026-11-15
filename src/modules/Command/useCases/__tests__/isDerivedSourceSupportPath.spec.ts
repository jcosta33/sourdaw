import { describe, expect, it } from 'vitest';

import { type AppActionType } from '#/utils/handlerContract';

import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { isDerivedSourceSupportPath } from '../isDerivedSourceSupportPath';

const allActionTypes = Object.keys(undoEntryStoresCommandIdByActionType) as AppActionType[];

const probePaths = [
    'rowPlan',
    'rowPlan.after',
    'rowPlanner',
    'audioSourcePromotion',
    'audioSourcePromotion.source',
    'audioSourcePromotions[0]',
    'expected[0].audioSource',
    'replacement[3].audioSource.id',
    'replacement[3].audioSourceId',
    'unrelated',
];

const supportedProbePathsByActionType: Partial<Record<AppActionType, readonly string[]>> = {
    editTempoMap: ['rowPlan', 'rowPlan.after', 'audioSourcePromotion', 'audioSourcePromotion.source'],
    restoreTempoMapEdit: ['rowPlan', 'rowPlan.after', 'audioSourcePromotion', 'audioSourcePromotion.source'],
    setTempo: ['audioSourcePromotion', 'audioSourcePromotion.source'],
    restoreTempoEdit: ['audioSourcePromotion', 'audioSourcePromotion.source'],
    setCompRegion: ['audioSourcePromotions[0]', 'expected[0].audioSource', 'replacement[3].audioSource.id'],
    removeCompRegion: ['audioSourcePromotions[0]', 'expected[0].audioSource', 'replacement[3].audioSource.id'],
    restoreCompRegionInterval: ['audioSourcePromotions[0]', 'expected[0].audioSource', 'replacement[3].audioSource.id'],
};

describe('isDerivedSourceSupportPath', () => {
    it('supports the listed probe paths for exactly the action types that promote a source', () => {
        for (const type of allActionTypes) {
            const supported = probePaths.filter((path) => isDerivedSourceSupportPath(type, path));

            expect(supported, type).toEqual(supportedProbePathsByActionType[type] ?? []);
        }
    });

    it('supports no path without an operation or for a name that is not an action type', () => {
        for (const operation of [undefined, 'constructor', 'toString', 'hasOwnProperty', '__proto__', 'noSuchAction']) {
            for (const path of probePaths) {
                expect(isDerivedSourceSupportPath(operation, path), `${String(operation)} ${path}`).toBe(false);
            }
        }
    });
});
