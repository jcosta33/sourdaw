import { describe, expect, it } from 'vitest';

import { toLevainDeviceState } from '../../models/LevainDeviceState';
import { createDefaultPatch, getArticulationId } from '../../models/LevainPatch';
import { projectLevainDeviceStateToNativePatch } from '../projectLevainDeviceStateToNativePatch';

describe('projectLevainDeviceStateToNativePatch', () => {
    it('projects the saved articulation as the engine id the body answers to', () => {
        const patch = { ...createDefaultPatch('violin-1'), currentArticulation: 'pizzicato' as const };
        const deviceState = toLevainDeviceState(patch);

        expect(projectLevainDeviceStateToNativePatch({ deviceState })).toEqual({
            current_articulation: getArticulationId('pizzicato'),
        });
    });

    it('distinguishes two saved articulations of the same instrument', () => {
        const sustain = toLevainDeviceState({ ...createDefaultPatch('violin-1'), currentArticulation: 'sustain' });
        const staccato = toLevainDeviceState({ ...createDefaultPatch('violin-1'), currentArticulation: 'staccato' });

        expect(projectLevainDeviceStateToNativePatch({ deviceState: sustain })).not.toEqual(
            projectLevainDeviceStateToNativePatch({ deviceState: staccato })
        );
    });

    it('answers null for a chunk this build cannot read', () => {
        // A null keeps the mapper's record untouched rather than folding a
        // guessed articulation into it: the chunk is the only source for the
        // choice, and a wrong id would sound a different set of zones.
        expect(projectLevainDeviceStateToNativePatch({ deviceState: { version: 99, data: {} } })).toBeNull();
        expect(
            projectLevainDeviceStateToNativePatch({ deviceState: { version: 1, data: { instrumentId: 'nope' } } })
        ).toBeNull();
    });
});
