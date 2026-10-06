import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/gainEnvelopeStore', () => ({
    getEnvelope: vi.fn(),
    setEnvelope: vi.fn(),
    removeEnvelope: vi.fn(),
}));

vi.mock('../../../useCases/clipGainEnvelope/toggleClipGainEnvelope', () => ({
    toggleClipGainEnvelope: vi.fn(),
}));

vi.mock('../../../useCases/clipGainEnvelope/addGainEnvelopePoint', () => ({
    addGainEnvelopePoint: vi.fn(),
}));

vi.mock('../../../useCases/clipGainEnvelope/removeGainEnvelopePoint', () => ({
    removeGainEnvelopePoint: vi.fn(),
}));

vi.mock('../../../useCases/clipGainEnvelope/resetClipGainEnvelope', () => ({
    resetClipGainEnvelope: vi.fn(),
}));

import { type AppAction } from '#/utils/handlerContract';

import { getEnvelope, removeEnvelope, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from '../../../useCases/clipGainEnvelope/addGainEnvelopePoint';
import { removeGainEnvelopePoint } from '../../../useCases/clipGainEnvelope/removeGainEnvelopePoint';
import { resetClipGainEnvelope } from '../../../useCases/clipGainEnvelope/resetClipGainEnvelope';
import { toggleClipGainEnvelope } from '../../../useCases/clipGainEnvelope/toggleClipGainEnvelope';
import { handleAddGainEnvelopePoint } from '../handleAddGainEnvelopePoint';
import { handleRemoveGainEnvelopePoint } from '../handleRemoveGainEnvelopePoint';
import { handleResetClipGainEnvelope } from '../handleResetClipGainEnvelope';
import { handleSetClipGainEnvelope } from '../handleSetClipGainEnvelope';
import { handleToggleClipGainEnvelope } from '../handleToggleClipGainEnvelope';

const mockedGetEnvelope = vi.mocked(getEnvelope);

beforeEach(() => {
    vi.clearAllMocks();
});

const priorEnvelope = {
    clipId: 'clip-vox',
    enabled: true,
    points: [
        { id: 'p1', beatOffset: 0, gainDb: 0 },
        { id: 'p2', beatOffset: 4, gainDb: -9 },
    ],
};

describe('handleToggleClipGainEnvelope', () => {
    it('conflicts instead of toggling blind when the pre-toggle value diverged', () => {
        mockedGetEnvelope.mockReturnValue({ ...priorEnvelope, enabled: true });
        const result = handleToggleClipGainEnvelope.execute({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-vox', expectedEnabled: false },
        });
        expect(result).toEqual({ status: 'conflict' });
        expect(toggleClipGainEnvelope).not.toHaveBeenCalled();
    });

    it('toggles when the pre-toggle value matches', () => {
        mockedGetEnvelope.mockReturnValue({ ...priorEnvelope, enabled: true });
        handleToggleClipGainEnvelope.execute({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-vox', expectedEnabled: true },
        });
        expect(toggleClipGainEnvelope).toHaveBeenCalledWith('clip-vox');
    });

    it('inverts with a guarded flip back onto the captured state', () => {
        mockedGetEnvelope.mockReturnValue({ ...priorEnvelope, enabled: false });
        const { inverseAction } = handleToggleClipGainEnvelope.describe({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-vox', expectedEnabled: false },
        });
        expect(inverseAction).toEqual({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-vox', expectedEnabled: true },
        });
    });

    it('inverts a first-toggle that created the envelope by removing it', () => {
        mockedGetEnvelope.mockReturnValue(undefined);
        const { inverseAction } = handleToggleClipGainEnvelope.describe({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-vox' },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: null },
        });
    });
});

describe('handleAddGainEnvelopePoint', () => {
    it('executes with a minted point id the inverse removes', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        const action: Extract<AppAction, { type: 'addGainEnvelopePoint' }> = {
            type: 'addGainEnvelopePoint',
            payload: { clipId: 'clip-vox', beatOffset: 2, gainDb: -3 },
        };
        handleAddGainEnvelopePoint.execute(action);
        const [, , , pointId] = vi.mocked(addGainEnvelopePoint).mock.calls[0]!;
        expect(pointId).toMatch(/^gep-/);
        expect(action.payload.pointId).toBe(pointId);
        const { inverseAction } = handleAddGainEnvelopePoint.describe(action);
        expect(inverseAction).toEqual({
            type: 'removeGainEnvelopePoint',
            payload: { clipId: 'clip-vox', pointId },
        });
    });

    it('restores the whole prior envelope when the add created it on an empty clip', () => {
        mockedGetEnvelope.mockReturnValue(undefined);
        const { inverseAction } = handleAddGainEnvelopePoint.describe({
            type: 'addGainEnvelopePoint',
            payload: { clipId: 'clip-vox', beatOffset: 2, gainDb: -3, pointId: 'gep-x' },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: null },
        });
    });
});

describe('handleRemoveGainEnvelopePoint', () => {
    it('executes the removal through the use case', () => {
        handleRemoveGainEnvelopePoint.execute({
            type: 'removeGainEnvelopePoint',
            payload: { clipId: 'clip-vox', pointId: 'p2' },
        });
        expect(removeGainEnvelopePoint).toHaveBeenCalledWith('clip-vox', 'p2');
    });

    it('restores the whole prior envelope — exact even through the zero-point substitution', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        const { inverseAction } = handleRemoveGainEnvelopePoint.describe({
            type: 'removeGainEnvelopePoint',
            payload: { clipId: 'clip-vox', pointId: 'p2' },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: priorEnvelope },
        });
    });

    it('carries no inverse when the point is not there', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        const { inverseAction } = handleRemoveGainEnvelopePoint.describe({
            type: 'removeGainEnvelopePoint',
            payload: { clipId: 'clip-vox', pointId: 'gone' },
        });
        expect(inverseAction).toBeFalsy();
    });
});

describe('handleResetClipGainEnvelope', () => {
    it('executes the reset and inverts onto the whole prior envelope', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        handleResetClipGainEnvelope.execute({ type: 'resetClipGainEnvelope', payload: { clipId: 'clip-vox' } });
        expect(resetClipGainEnvelope).toHaveBeenCalledWith('clip-vox');
        const { inverseAction } = handleResetClipGainEnvelope.describe({
            type: 'resetClipGainEnvelope',
            payload: { clipId: 'clip-vox' },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: priorEnvelope },
        });
    });

    it('inverts a reset of an envelope-less clip by removing the created envelope', () => {
        mockedGetEnvelope.mockReturnValue(undefined);
        const { inverseAction } = handleResetClipGainEnvelope.describe({
            type: 'resetClipGainEnvelope',
            payload: { clipId: 'clip-vox' },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: null },
        });
    });
});

describe('handleSetClipGainEnvelope', () => {
    it('stores a thawed copy of the snapshot envelope', () => {
        handleSetClipGainEnvelope.execute({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: priorEnvelope },
        });
        expect(setEnvelope).toHaveBeenCalledWith('clip-vox', priorEnvelope);
        expect(vi.mocked(setEnvelope).mock.calls[0]![1]).not.toBe(priorEnvelope);
    });

    it('removes the envelope for a null payload', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        const result = handleSetClipGainEnvelope.execute({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: null },
        });
        expect(removeEnvelope).toHaveBeenCalledWith('clip-vox');
        expect(result).toBeUndefined();
    });

    it('inverts onto whatever the clip carried before', () => {
        mockedGetEnvelope.mockReturnValue(priorEnvelope);
        const { inverseAction } = handleSetClipGainEnvelope.describe({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: null },
        });
        expect(inverseAction).toEqual({
            type: 'setClipGainEnvelope',
            payload: { clipId: 'clip-vox', envelope: priorEnvelope },
        });
    });
});
