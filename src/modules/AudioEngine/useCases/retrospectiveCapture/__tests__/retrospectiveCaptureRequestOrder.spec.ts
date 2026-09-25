import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArmRetrospectiveCaptureResult } from '../../../repositories/retrospectiveCapture/armRetrospectiveCapture';
import { armRetrospectiveCapture } from '../armRetrospectiveCapture';
import { disarmRetrospectiveCapture } from '../disarmRetrospectiveCapture';

const sent = vi.hoisted((): string[] => []);
const mockArmRepo = vi.hoisted(() => vi.fn<(trackId: string, channels: number) => Promise<unknown>>());
const mockDisarmRepo = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const mockLogError = vi.hoisted(() => vi.fn<(error: Error) => void>());

vi.mock('../../../repositories/retrospectiveCapture/armRetrospectiveCapture', () => ({
    armRetrospectiveCapture: mockArmRepo,
}));

vi.mock('../../../repositories/retrospectiveCapture/disarmRetrospectiveCapture', () => ({
    disarmRetrospectiveCapture: mockDisarmRepo,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mockLogError },
}));

/** Let every queued promise reaction run: a macrotask starts only once the microtask queue is empty. */
async function drainPendingReactions(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('retrospective capture request order', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sent.length = 0;
        mockDisarmRepo.mockImplementation(() => {
            sent.push('disarm');
            return Promise.resolve({ outcome: 'applied' });
        });
    });

    it('holds a disarm until the arm issued before it settles', async () => {
        const arm = Promise.withResolvers<ArmRetrospectiveCaptureResult>();
        mockArmRepo.mockImplementation(() => {
            sent.push('arm');
            return arm.promise;
        });

        armRetrospectiveCapture('track-1');
        disarmRetrospectiveCapture();

        await vi.waitFor(() => expect(mockArmRepo).toHaveBeenCalledWith('track-1', 2));
        await drainPendingReactions();
        expect(mockDisarmRepo).not.toHaveBeenCalled();

        arm.resolve({ outcome: 'applied' });

        await vi.waitFor(() => expect(mockDisarmRepo).toHaveBeenCalledTimes(1));
        expect(sent).toEqual(['arm', 'disarm']);
    });

    it('still sends the disarm after the arm before it rejects, and logs the rejection', async () => {
        const arm = Promise.withResolvers<ArmRetrospectiveCaptureResult>();
        mockArmRepo.mockImplementation(() => {
            sent.push('arm');
            return arm.promise;
        });

        armRetrospectiveCapture('track-1');
        disarmRetrospectiveCapture();

        await vi.waitFor(() => expect(mockArmRepo).toHaveBeenCalledTimes(1));
        await drainPendingReactions();
        expect(mockDisarmRepo).not.toHaveBeenCalled();

        const failure = new Error('arm transport failed');
        arm.reject(failure);

        await vi.waitFor(() => expect(mockDisarmRepo).toHaveBeenCalledTimes(1));
        expect(sent).toEqual(['arm', 'disarm']);
        expect(mockLogError).toHaveBeenCalledWith(failure);
    });
});
