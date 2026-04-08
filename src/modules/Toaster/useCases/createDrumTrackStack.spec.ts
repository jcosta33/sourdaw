import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createDrumTrackStack } from './createDrumTrackStack';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { setTrackStoreState } from '#/modules/Arrangement/useCases/setTrackStoreState';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls';

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases/setTrackStoreState', () => ({
    setTrackStoreState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/deviceControls', () => ({
    addDeviceToStrip: vi.fn(),
}));

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('createDrumTrackStack', () => {
    beforeEach(() => {
        vi.mocked(getTrackStoreState).mockReset();
        vi.mocked(setTrackStoreState).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
    });

    it('should return null when track store is not ready', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createDrumTrackStack, { eventBus });

        expect(createDrumTrackStack()).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should create folder stack, wire toaster, emit track.added, and return parent id', () => {
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(createDrumTrackStack, { eventBus });

        const parentId = createDrumTrackStack();

        expect(parentId).not.toBeNull();
        expect(setTrackStoreState).toHaveBeenCalled();
        expect(addDeviceToStrip).toHaveBeenCalledWith(parentId, expect.stringMatching(/^toaster-/), 'toaster');
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ trackId: parentId, kind: 'folder' })
        );
    });
});
