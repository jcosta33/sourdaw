import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { trackStore } from '../../../stores/trackStore';
import { createTrack } from '../../createTrack';
import { captureDevicePatchCommitValidation } from '../captureDevicePatchCommitValidation';

describe('device patch publication transition authority', () => {
    beforeEach(async () => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const project = runProjectLoadTransaction();
        expect(await project.prepare()).toBe(true);
        expect(project.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('device publication authority');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        trackStore.set({
            tracks: [createTrack({ id: 'owner', kind: 'midi', name: 'Owner', withoutDefaultDevice: true })],
            selectedTrackId: 'owner',
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['owner', 'missing-owner'])('captures an honest absent device identity on %s', (trackId) => {
        const proof = captureDevicePatchCommitValidation({ trackId, deviceId: 'not-installed', parameterIds: [] });
        expect(proof).not.toBeNull();
        expect(proof?.isCurrent()).toBe(true);
    });

    it.each(['activate', 'fail'] as const)(
        'revokes captured source before the successor can %s, even with unchanged raw truth',
        async (outcome) => {
            const raw = getCrdtDoc('root');
            const proof = captureDevicePatchCommitValidation({
                trackId: 'owner',
                deviceId: 'not-installed',
                parameterIds: [],
            });
            expect(proof?.isCurrent()).toBe(true);
            const entered = Promise.withResolvers<void>();
            const shutdown = Promise.withResolvers<void>();
            setProjectIdentityTransitionDependencies({
                leaveCollaborationSession: () => {
                    entered.resolve();
                    return shutdown.promise;
                },
            });
            const successor = runProjectLoadTransaction();
            const preparing = successor.prepare();
            await entered.promise;
            expect(successor.activate()).toBe(false);
            expect(getCrdtDoc('root')).toBe(raw);
            expect(proof?.isCurrent()).toBe(false);
            expect(
                captureDevicePatchCommitValidation({ trackId: 'owner', deviceId: 'not-installed', parameterIds: [] })
            ).toBeNull();
            if (outcome === 'fail') {
                const failure = new Error('collaboration shutdown failed');
                const rejected = expect(preparing).rejects.toBe(failure);
                shutdown.reject(failure);
                await rejected;
                expect(successor.activate()).toBe(false);
                const fresh = captureDevicePatchCommitValidation({
                    trackId: 'owner',
                    deviceId: 'not-installed',
                    parameterIds: [],
                });
                expect(fresh?.isCurrent()).toBe(true);
            } else {
                shutdown.resolve();
                expect(await preparing).toBe(true);
                expect(successor.activate()).toBe(true);
            }
            expect(getCrdtDoc('root')).toBe(raw);
            expect(proof?.isCurrent()).toBe(false);
            setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
            const returned = runProjectLoadTransaction();
            expect(await returned.prepare()).toBe(true);
            expect(returned.activate()).toBe(true);
            expect(getCrdtDoc('root')).toBe(raw);
            expect(proof?.isCurrent()).toBe(false);
            expect(
                captureDevicePatchCommitValidation({
                    trackId: 'owner',
                    deviceId: 'not-installed',
                    parameterIds: [],
                })?.isCurrent()
            ).toBe(true);
        }
    );
});
