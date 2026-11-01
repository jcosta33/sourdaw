import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' as string | undefined,
    eligible: true,
    commit: vi.fn(),
}));

vi.mock('#/modules/Project/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/stores')>()),
    getSettledProjectIdentity: () => (mocks.projectId ? { projectId: mocks.projectId } : undefined),
}));
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: () =>
        mocks.eligible ? { status: 'eligible', trackId: 'track', deviceId: 'toaster' } : { status: 'ineligible' },
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.commit,
}));

import { createDefaultKit } from '../../models/ToasterKit';
import { fromToasterKitState } from '../../models/ToasterKitState';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { copyMorphTargetPattern } from '../copyMorphTargetPattern';
import { selectMorphSourcePattern } from '../setMorphPosition/selectMorphSourcePattern';
import { setMorphPosition } from '../setMorphPosition/setMorphPosition';
import { setMorphTarget } from '../setMorphPosition/setMorphTarget';
import { toggleMorph } from '../setMorphPosition/toggleMorph';

const DEVICE_ID = 'toaster';

function currentKit() {
    const kit = toasterStore.value?.[DEVICE_ID]?.kit;
    if (!kit) {
        throw new Error('Toaster fixture is absent');
    }
    return kit;
}

describe('Toaster morph command admission', () => {
    beforeEach(() => {
        mocks.commit.mockReset();
        mocks.commit.mockImplementation(async (_action, options) => {
            options?.onCommitted?.();
        });
        mocks.eligible = true;
        mocks.projectId = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
        toasterStore.set({ [DEVICE_ID]: { ...defaultToasterState, kit: createDefaultKit() } });
    });

    it('copies an independent B, keeps A selected, and writes both in typed device state', async () => {
        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(true);
        const kit = currentKit();
        expect(kit.activePatternId).toBe('A1');
        expect(kit.patterns.map((pattern) => pattern.id)).toEqual(['A1', 'B1']);
        expect(kit.morph).toMatchObject({ targetPatternId: 'B1', enabled: false });
        expect(kit.patterns[1]?.tracks[0]?.steps[0]).not.toBe(kit.patterns[0]?.tracks[0]?.steps[0]);

        const action = mocks.commit.mock.calls[0]?.[0];
        expect(action.type).toBe('setDeviceState');
        expect(fromToasterKitState(action.payload.state)).toEqual(kit);
    });

    it('chooses B for editing, disables self morph, then permits A to re-enable B', async () => {
        await copyMorphTargetPattern(DEVICE_ID);
        await toggleMorph(DEVICE_ID);
        expect(currentKit().morph?.enabled).toBe(true);

        await selectMorphSourcePattern(DEVICE_ID, 'B1');
        expect(currentKit().activePatternId).toBe('B1');
        expect(currentKit().morph).toMatchObject({ targetPatternId: 'B1', enabled: false });
        expect(await toggleMorph(DEVICE_ID)).toBe(false);

        await selectMorphSourcePattern(DEVICE_ID, 'A1');
        expect(await toggleMorph(DEVICE_ID)).toBe(true);
        expect(currentKit().morph?.enabled).toBe(true);
    });

    it('clamps finite positions and refuses non-finite values or invalid and self targets', async () => {
        expect(await setMorphPosition(DEVICE_ID, 0.25)).toBe(false);
        expect(mocks.commit).not.toHaveBeenCalled();
        await copyMorphTargetPattern(DEVICE_ID);
        expect(await setMorphPosition(DEVICE_ID, 3)).toBe(true);
        expect(currentKit().morph?.position).toBe(1);
        const commits = mocks.commit.mock.calls.length;
        expect(await setMorphPosition(DEVICE_ID, Number.NaN)).toBe(false);
        expect(await setMorphTarget(DEVICE_ID, 'A1')).toBe(false);
        expect(await setMorphTarget(DEVICE_ID, 'missing')).toBe(false);
        expect(mocks.commit.mock.calls).toHaveLength(commits);
    });

    it('leaves the session kit untouched when the command refuses or the project switches', async () => {
        const initial = currentKit();
        mocks.commit.mockImplementationOnce(async () => {});
        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(false);
        expect(currentKit()).toBe(initial);

        expect(await copyMorphTargetPattern(DEVICE_ID)).toBe(true);
        const before = currentKit();

        mocks.commit.mockImplementationOnce(async (_action, options) => {
            mocks.projectId = 'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb';
            if (!options?.shouldExecute?.()) {
                return;
            }
            options?.onCommitted?.();
        });
        expect(await setMorphPosition(DEVICE_ID, 0.5)).toBe(false);
        expect(currentKit()).toBe(before);
    });
});
