import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyDevicePatchState,
    captureDevicePatchCommitValidation,
    getPlannedDevicePatchState,
} from '#/modules/Arrangement/useCases';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { getToasterPresetDeviceState } from '../../useCases/getToasterPresetDeviceState';
import { handleSetToasterFactoryKit } from '../handleSetToasterFactoryKit';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    applyDevicePatchState: vi.fn(),
    captureDevicePatchCommitValidation: vi.fn(),
    getPlannedDevicePatchState: vi.fn(),
}));

const after = getToasterPresetDeviceState('909-punchy');
if (!after) {
    throw new Error('Missing factory kit');
}
const action = {
    type: 'setToasterFactoryKit',
    payload: { trackId: 'track', deviceId: 'device', deviceIds: ['device'], before: null, after, label: 'Load kit' },
} satisfies AppAction;

function context(sibling?: AppAction, preview = false): HandlerValidationContext {
    const batch = {
        actions: sibling ? [action, sibling] : [action],
        actionIndex: 0,
    };
    return preview ? { ...batch, executionMode: 'isolated-preview' } : batch;
}

const release = vi.fn();
const captureWrittenState = vi.fn();
const validation = { documentId: 'root', beforeCommit: () => null, validateDocument: () => null, release };
const start = vi.fn(() => ({ validation, captureWrittenState }));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlannedDevicePatchState).mockReturnValue({
        kind: 'device',
        trackId: 'track',
        deviceId: 'device',
        deviceIds: ['device'],
        frozen: false,
        deviceType: DEVICE_TYPE_IDS.toaster,
        state: { deviceState: null, parameterValues: {} },
    });
    vi.mocked(captureDevicePatchCommitValidation).mockReturnValue({
        isCurrent: () => true,
        matchesCommittedParameters: () => false,
        start,
    });
    vi.mocked(applyDevicePatchState).mockReturnValue(true);
    captureWrittenState.mockReturnValue(true);
});

describe('factory kit handler admission and write proof', () => {
    it.each([
        { type: 'removeAllTracks' },
        { type: 'removeTrack', payload: { trackId: 'track' } },
        { type: 'discardImportedStemSet', payload: { folderId: 'track', stemTrackIds: [], guards: [] } },
        { type: 'discardImportedStemSet', payload: { folderId: 'folder', stemTrackIds: ['track'], guards: [] } },
        {
            type: 'restoreDevice',
            payload: {
                trackId: 'track',
                deviceSnapshot: {
                    id: 'device',
                    type: 'toaster',
                    name: 'Toaster',
                    bypassed: false,
                    parameterValues: {},
                },
                deviceIndex: 0,
            },
        },
    ] satisfies AppAction[])('refuses an unsafe sibling: $type', (sibling) => {
        expect(handleSetToasterFactoryKit.validate?.(action, context(sibling))).toBe(false);
        expect(handleSetToasterFactoryKit.canReapplyAfterDivergence?.(action, context(sibling))).toBe(false);
        expect(captureDevicePatchCommitValidation).not.toHaveBeenCalled();
    });

    it('admits unrelated stem removal and rechecks divergence without capturing a proof', () => {
        const sibling = {
            type: 'discardImportedStemSet',
            payload: { folderId: 'folder', stemTrackIds: ['other'], guards: [] },
        } satisfies AppAction;
        expect(handleSetToasterFactoryKit.canReapplyAfterDivergence?.(action, context(sibling))).toBe(true);
        expect(captureDevicePatchCommitValidation).not.toHaveBeenCalled();
        expect(handleSetToasterFactoryKit.validate?.(action, context(sibling))).toBe(true);
        vi.mocked(getPlannedDevicePatchState).mockReturnValue(null);
        expect(handleSetToasterFactoryKit.canReapplyAfterDivergence?.(action, context(sibling))).toBe(false);
    });

    it('writes an isolated preview without acquiring a live proof', () => {
        const preview = context(undefined, true);
        expect(handleSetToasterFactoryKit.validate?.(action, preview)).toBe(true);
        expect(handleSetToasterFactoryKit.execute(action, preview)).toMatchObject({ status: 'written' });
        expect(captureDevicePatchCommitValidation).not.toHaveBeenCalled();
        expect(applyDevicePatchState).toHaveBeenCalledWith({
            deviceId: 'device',
            expected: { deviceState: null, parameterValues: {} },
            next: { deviceState: after, parameterValues: {} },
        });
    });

    it('refuses a live execution without admission', () => {
        expect(handleSetToasterFactoryKit.execute(action)).toEqual({ status: 'conflict' });
        expect(applyDevicePatchState).not.toHaveBeenCalled();
    });

    it.each(['write', 'proof'] as const)('releases the proof when %s fails', (failure) => {
        if (failure === 'write') {
            vi.mocked(applyDevicePatchState).mockReturnValue(false);
        } else {
            captureWrittenState.mockReturnValue(false);
        }
        expect(handleSetToasterFactoryKit.validate?.(action, context())).toBe(true);
        expect(handleSetToasterFactoryKit.execute(action)).toEqual({ status: 'conflict' });
        expect(release).toHaveBeenCalledOnce();
        expect(captureWrittenState).toHaveBeenCalledTimes(failure === 'proof' ? 1 : 0);
    });

    it('transfers a successful proof to the commit owner', () => {
        expect(handleSetToasterFactoryKit.validate?.(action, context())).toBe(true);
        expect(handleSetToasterFactoryKit.execute(action)).toMatchObject({
            status: 'written',
            commitValidation: validation,
        });
        expect(captureWrittenState).toHaveBeenCalledWith({ deviceState: after, parameterValues: {} });
        expect(release).not.toHaveBeenCalled();
    });
});
