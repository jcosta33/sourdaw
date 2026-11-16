import { describe, expect, it } from 'vitest';

import { dbToGain, gainToDb } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { MAX_MASTER_GAIN } from '../../../stores/transportStore';
import {
    masterGainProjectionByActionType,
    projectMasterGainThroughPriorBatchActions,
} from '../projectMasterGainThroughPriorBatchActions';

function project(livePercent: number, prior: readonly AppAction[]): number {
    return projectMasterGainThroughPriorBatchActions(livePercent, {
        actions: [...prior, { type: 'toggleLoop' }],
        actionIndex: prior.length,
    });
}

describe('projectMasterGainThroughPriorBatchActions', () => {
    it('moves the master percent for exactly the two master-gain actions', () => {
        const keep = masterGainProjectionByActionType.selectTrack;
        const movingEntries = Object.entries(masterGainProjectionByActionType).filter(([, entry]) => entry !== keep);
        const moving = movingEntries.map(([type]) => type).sort();
        expect(moving).toEqual(['restoreMasterGain', 'setMasterGain']);
    });

    it('takes the replacement percent of a restore directly', () => {
        expect(
            project(80, [{ type: 'restoreMasterGain', payload: { expectedPercent: 80, replacementPercent: 35 } }])
        ).toBe(35);
    });

    it('resolves a set against the percent the earlier actions left, bounded to the store range', () => {
        expect(project(80, [{ type: 'setMasterGain', payload: { gain: 0.5 } }])).toBeCloseTo(50);
        expect(project(80, [{ type: 'setMasterGain', payload: { gain: 1000 } }])).toBe(MAX_MASTER_GAIN);
        expect(
            project(80, [
                { type: 'restoreMasterGain', payload: { expectedPercent: 80, replacementPercent: 20 } },
                { type: 'setMasterGain', payload: { gain: 0.5 } },
            ])
        ).toBeCloseTo(50);
    });

    it('bounds a projected set below at silence', () => {
        expect(project(80, [{ type: 'setMasterGain', payload: { gain: -1 } }])).toBe(0);
    });

    it('resolves an absolute decibel set to its percent and refuses one above the fader ceiling', () => {
        expect(project(80, [{ type: 'setMasterGain', payload: { gainDb: -6 } }])).toBeCloseTo(100 * dbToGain(-6), 6);
        expect(project(80, [{ type: 'setMasterGain', payload: { gainDb: 12 } }])).toBe(80);
    });

    it('measures a relative decibel set from the percent the earlier actions left', () => {
        expect(project(80, [{ type: 'setMasterGain', payload: { deltaDb: -6 } }])).toBeCloseTo(
            100 * dbToGain(gainToDb(0.8) - 6),
            6
        );
        expect(
            project(80, [
                { type: 'restoreMasterGain', payload: { expectedPercent: 80, replacementPercent: 50 } },
                { type: 'setMasterGain', payload: { deltaDb: -6 } },
            ])
        ).toBeCloseTo(100 * dbToGain(gainToDb(0.5) - 6), 6);
    });

    it('keeps the percent for an unrelated action or an unresolvable level', () => {
        expect(project(80, [{ type: 'selectTrack', payload: { trackId: 't' } }])).toBe(80);
        expect(project(80, [{ type: 'setMasterGain', payload: {} }])).toBe(80);
    });
});
