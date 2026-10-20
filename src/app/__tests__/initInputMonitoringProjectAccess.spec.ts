import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    mutateCrdtDoc,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { initInputMonitoringProjectAccess } from '../initInputMonitoringProjectAccess';

import type { configureInputMonitoringProjectAccess } from '#/modules/AudioEngine/useCases';

type ProjectAccess = NonNullable<Parameters<typeof configureInputMonitoringProjectAccess>[0]>;

const registration = vi.hoisted(() => ({
    configure: vi.fn<(next: ProjectAccess | null) => void>(),
    subscribe: vi.fn<(listener: (docId?: string) => void) => void>(),
}));

// Observe the dependency registration; committed documents and their change events remain real.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    configureInputMonitoringProjectAccess: registration.configure,
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...actual,
        subscribeToCrdtChanges: (listener: (docId?: string) => void) => {
            registration.subscribe(listener);
            return actual.subscribeToCrdtChanges(listener);
        },
    };
});

function registeredAccess(): ProjectAccess {
    const access = registration.configure.mock.calls.at(-1)?.[0];
    if (!access) {
        throw new Error('Expected registered project access');
    }
    return access;
}

function publishCommittedTrack(trackId: string): void {
    const track = createTrack({ id: trackId, name: `Audio ${trackId}`, kind: 'audio', withoutDefaultDevice: true });
    mutateCrdtDoc({
        id: 'root',
        changeFn: (document) => {
            document.tracks = { tracks: [track] };
        },
    });
}

describe('initInputMonitoringProjectAccess', () => {
    let unsubscribe: (() => void) | undefined;

    beforeEach(() => {
        registration.configure.mockClear();
        registration.subscribe.mockClear();
        createCrdtDoc('root');
        initInputMonitoringProjectAccess();
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        removeCrdtDoc('root');
        removeCrdtDoc('branch-monitor-test');
    });

    it('reads each committed root afresh and treats a missing root or track slot as no owner', () => {
        const access = registeredAccess();
        expect(access.captureRootIdentity()).toBe(captureProjectRootIdentity());
        expect(access.hasTrack('a')).toBe(false);
        expect(access.readTrack('a')).toBeNull();
        publishCommittedTrack('a');
        expect(access.hasTrack('a')).toBe(true);
        expect(access.readTrack('a')).toEqual({ inputMonitoring: 'auto', inputId: null, kind: 'audio', armed: false });
        mutateCrdtDoc({
            id: 'root',
            changeFn: (document) => {
                const slot = document.tracks;
                if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
                    throw new Error('Expected committed tracks');
                }
                slot.tracks[0].inputMonitoring = 'on';
                slot.tracks[0].inputId = 'chosen-input';
            },
        });
        expect(access.readTrack('a')).toEqual({
            inputMonitoring: 'on',
            inputId: 'chosen-input',
            kind: 'audio',
            armed: false,
        });
        publishCommittedTrack('b');
        expect(access.hasTrack('a')).toBe(false);
        expect(access.hasTrack('b')).toBe(true);
        removeCrdtDoc('root');
        expect(access.hasTrack('b')).toBe(false);
        expect(access.readTrack('b')).toBeNull();
    });

    it('subscribes only when the owner requests it, filters other documents, and disposes its listener', () => {
        const listener = vi.fn();
        expect(registration.subscribe).not.toHaveBeenCalled();
        publishCommittedTrack('a');
        expect(listener).not.toHaveBeenCalled();
        unsubscribe = registeredAccess().subscribe(listener);
        createCrdtDoc('branch-monitor-test');
        mutateCrdtDoc({
            id: 'branch-monitor-test',
            changeFn: (document) => {
                document.test = true;
            },
        });
        expect(listener).not.toHaveBeenCalled();
        publishCommittedTrack('b');
        expect(listener).toHaveBeenCalledTimes(1);
        const documentListener = registration.subscribe.mock.calls[0]?.[0];
        if (!documentListener) {
            throw new Error('Expected the registered document listener');
        }
        // Bulk operations deliver the same listener an undefined document hint.
        documentListener(undefined);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        publishCommittedTrack('a');
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
