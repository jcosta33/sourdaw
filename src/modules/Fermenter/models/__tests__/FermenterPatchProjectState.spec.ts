import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../FermenterPatch';
import {
    cloneFermenterPatch,
    fromFermenterDeviceState,
    readFermenterPatchFromProjectDevice,
    toFermenterDeviceState,
} from '../FermenterPatchState';
import {
    captureFermenterPatchProjectState,
    fermenterPatchProjectStatesEqual,
    projectFermenterPatchState,
} from '../FermenterPatchProjectState';

describe('Fermenter patch project representation', () => {
    it('captures exact relevant absence and detaches the owned chunk without including unrelated scalar leaves', () => {
        const source = {
            deviceState: toFermenterDeviceState(DEFAULT_PATCH),
            parameterValues: { filterCutoff: 600, unrelated: 9 },
        };
        const captured = captureFermenterPatchProjectState(source);
        expect(captured.deviceState).toEqual(source.deviceState);
        expect(captured.deviceState).not.toBe(source.deviceState);
        expect(captured.parameterValues.filterCutoff).toBe(600);
        expect(captured.parameterValues.filterModel).toBeNull();
        expect(captured.parameterValues).not.toHaveProperty('unrelated');
        expect(captureFermenterPatchProjectState({ parameterValues: {} }).deviceState).toBeNull();
    });

    it('represents a pending macro/mapping draft completely while retaining unrelated default scalar absence', () => {
        const source = { parameterValues: { filterCutoff: 600, macro0: 0.4 } };
        const project = readFermenterPatchFromProjectDevice(source);
        const draft = cloneFermenterPatch(project);
        draft.macros[0] = 0.83;
        draft.macroMappings![0]!.targets[0]!.center = 0.47;
        draft.filterCutoff = 1234;
        const represented = projectFermenterPatchState(
            captureFermenterPatchProjectState(source),
            project,
            draft,
            (_key, value) => value
        );
        expect(fromFermenterDeviceState(represented.deviceState)).toEqual(draft);
        expect(represented.parameterValues.filterCutoff).toBe(1234);
        expect(represented.parameterValues.filterModel).toBeNull();
        expect(represented.parameterValues.macro0).toBe(0.4);
    });

    it('preserves other owned chunk fields while applying numeric laws to the explicit scalar footprint', () => {
        const source = {
            deviceState: {
                ...toFermenterDeviceState(DEFAULT_PATCH),
                data: { ...toFermenterDeviceState(DEFAULT_PATCH).data, editorTag: 'keep' },
            },
            parameterValues: { filterCutoff: 600 },
        };
        const project = readFermenterPatchFromProjectDevice(source);
        const represented = projectFermenterPatchState(
            captureFermenterPatchProjectState(source),
            project,
            { ...project, filterCutoff: 25000, filterModel: 2 },
            (key, value) => (key === 'filterCutoff' ? 20000 : value)
        );
        expect(represented.deviceState?.data.editorTag).toBe('keep');
        expect(represented.parameterValues.filterCutoff).toBe(20000);
        expect(represented.parameterValues.filterModel).toBe(2);
    });

    it('compares key-order independently and distinguishes absent from an explicit default scalar', () => {
        const captured = captureFermenterPatchProjectState({ parameterValues: {} });
        const reordered = {
            ...captured,
            parameterValues: Object.fromEntries(Object.entries(captured.parameterValues).reverse()),
        };
        expect(fermenterPatchProjectStatesEqual(captured, reordered)).toBe(true);
        expect(
            fermenterPatchProjectStatesEqual(captured, {
                ...captured,
                parameterValues: { ...captured.parameterValues, filterModel: 0 },
            })
        ).toBe(false);
    });
});
