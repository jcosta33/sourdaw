import { describe, it, expect, vi, beforeEach } from 'vitest';

import { captureTouchAutomationRecordingAuthority } from '../captureTouchAutomationRecordingAuthority';
import { discardTouchAutomation } from '../discardTouchAutomation';
import { releaseTouchAutomation } from '../releaseTouchAutomation';

const { activeRecording, pendingPoints, pendingOwners, touchActive, flushPendingPoints, trackSnapshot } = vi.hoisted(
    () => {
        const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
        const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
        const pendingOwners = new Map<string, Array<symbol | undefined>>();
        const touchActive = new Set<string>();
        const trackSnapshot: { value: { tracks: { id: string; automationMode: string }[] } | null } = { value: null };
        return {
            trackSnapshot,
            activeRecording,
            pendingPoints,
            pendingOwners,
            touchActive,
            flushPendingPoints: vi.fn(),
        };
    }
);

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackSnapshot.value;
        },
    },
}));

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    pendingPoints,
    pendingOwners,
    touchActive,
}));

vi.mock('../flushPendingPoints', () => ({
    flushPendingPoints,
}));

describe('releaseTouchAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        pendingPoints.clear();
        pendingOwners.clear();
        touchActive.clear();
        trackSnapshot.value = null;
    });

    it('removes the key from touchActive and flushes pending points for that parameter', () => {
        touchActive.add('t1::gain');

        releaseTouchAutomation('t1', 'gain');

        expect(touchActive.has('t1::gain')).toBe(false);
        expect(flushPendingPoints).toHaveBeenCalledTimes(1);
        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
    });

    it('is a no-op on touchActive when the key was not active', () => {
        releaseTouchAutomation('t2', 'pan');

        expect(flushPendingPoints).toHaveBeenCalledWith('t2::pan');
        expect(touchActive.size).toBe(0);
    });

    // Regression (Batch B fix 2): latch's isRecordingAutomation stays true while
    // session.lastValue !== null, so without clearing it on release the lane keeps
    // being skipped by applyAutomation and the engine drifts off the curve.
    it('resets the latch session lastValue on release so recording disarms', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5,
        });
        touchActive.add('t1::gain');

        releaseTouchAutomation('t1', 'gain');

        expect(activeRecording.get('t1::gain')?.lastValue).toBeNull();
    });

    it.each(['owned', 'successor', 'ownerless', 'absent'] as const)(
        'releases only its latest recorded producer when the session is %s',
        (producer) => {
            const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
            let recordingOwner: symbol | undefined;
            if (producer === 'owned') {
                recordingOwner = authority.owner;
            } else if (producer === 'successor') {
                recordingOwner = Symbol('new gesture');
            }
            if (producer !== 'absent') {
                activeRecording.set('t1::gain', {
                    parameterId: 'gain',
                    trackId: 't1',
                    startBeat: 0,
                    lastValue: 0.5,
                    recordingOwner,
                });
                touchActive.add('t1::gain');
            }

            authority.release();

            expect(flushPendingPoints).toHaveBeenCalledTimes(producer === 'owned' ? 1 : 0);
            expect(touchActive.has('t1::gain')).toBe(producer === 'successor' || producer === 'ownerless');
            let expectedLastValue: number | null | undefined = 0.5;
            if (producer === 'owned') {
                expectedLastValue = null;
            } else if (producer === 'absent') {
                expectedLastValue = undefined;
            }
            expect(activeRecording.get('t1::gain')?.lastValue).toBe(expectedLastValue);
        }
    );

    it.each(['owned', 'successor', 'ownerless', 'absent'] as const)(
        'discards pending points only for its latest recorded producer when the session is %s',
        (producer) => {
            const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
            const point = { beat: 4, value: 0.5, curve: 'linear' as const, tension: 0 };
            pendingPoints.set('t1::gain', [point]);
            let recordingOwner: symbol | undefined;
            if (producer === 'owned') {
                recordingOwner = authority.owner;
            } else if (producer === 'successor') {
                recordingOwner = Symbol('new gesture');
            }
            pendingOwners.set('t1::gain', [recordingOwner]);
            if (producer !== 'absent') {
                activeRecording.set('t1::gain', {
                    parameterId: 'gain',
                    trackId: 't1',
                    startBeat: 0,
                    lastValue: 0.5,
                    recordingOwner,
                });
                touchActive.add('t1::gain');
            }

            discardTouchAutomation('t1', 'gain', authority.owner);

            expect(flushPendingPoints).not.toHaveBeenCalled();
            expect(pendingPoints.get('t1::gain')).toEqual(producer === 'owned' ? [] : [point]);
            expect(pendingOwners.get('t1::gain')).toEqual(producer === 'owned' ? [] : [recordingOwner]);
            expect(touchActive.has('t1::gain')).toBe(producer === 'successor' || producer === 'ownerless');
            let expectedLastValue: number | null | undefined = 0.5;
            if (producer === 'owned') {
                expectedLastValue = null;
            } else if (producer === 'absent') {
                expectedLastValue = undefined;
            }
            expect(activeRecording.get('t1::gain')?.lastValue).toBe(expectedLastValue);
        }
    );

    // Mixed producer buffer: every admitted producer supersedes the release
    // authority, but a discard must destroy only the discarding producer's own
    // samples. An ownerless predecessor recorded before the authority's
    // gesture survives, keeps the buffer's tail as the latch window, and keeps
    // the touch arm — another producer is still touching the same lane.
    it('removes only the discarding authority samples from a mixed buffer, keeping a foreign predecessor', () => {
        const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
        const foreign = { beat: 2, value: 0.3, curve: 'linear' as const, tension: 0 };
        const own = { beat: 4, value: 0.7, curve: 'linear' as const, tension: 0 };
        pendingPoints.set('t1::gain', [foreign, own]);
        pendingOwners.set('t1::gain', [undefined, authority.owner]);
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.7,
            recordingOwner: authority.owner,
        });
        touchActive.add('t1::gain');

        authority.discard();

        expect(pendingPoints.get('t1::gain')).toEqual([foreign]);
        expect(pendingOwners.get('t1::gain')).toEqual([undefined]);
        expect(activeRecording.get('t1::gain')?.lastValue).toBe(0.3);
        expect(touchActive.has('t1::gain')).toBe(true);
    });

    // Same mixed ownership with the foreign sample at the tail: removing the
    // authority's earlier point re-anchors the latch window to the remaining
    // tail instead of ending it.
    it('removes only the discarding authority samples from a mixed buffer, keeping a foreign successor', () => {
        const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
        const own = { beat: 2, value: 0.7, curve: 'linear' as const, tension: 0 };
        const foreign = { beat: 4, value: 0.3, curve: 'linear' as const, tension: 0 };
        pendingPoints.set('t1::gain', [own, foreign]);
        pendingOwners.set('t1::gain', [authority.owner, Symbol('other producer')]);
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.3,
            recordingOwner: authority.owner,
        });
        touchActive.add('t1::gain');

        authority.discard();

        expect(pendingPoints.get('t1::gain')).toEqual([foreign]);
        expect(activeRecording.get('t1::gain')?.lastValue).toBe(0.3);
        expect(touchActive.has('t1::gain')).toBe(true);
    });

    // The all-owned row above covers the fully-owned clear; an ownerless
    // discarding authority must likewise remove only ownerless points, not a
    // producer's samples that share the same buffer.
    it('discards only ownerless points when the discarding authority recorded no owner', () => {
        const ownerless = { beat: 2, value: 0.3, curve: 'linear' as const, tension: 0 };
        const owned = { beat: 4, value: 0.7, curve: 'linear' as const, tension: 0 };
        const producer = Symbol('producing gesture');
        pendingPoints.set('t1::gain', [ownerless, owned]);
        pendingOwners.set('t1::gain', [undefined, producer]);
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.7,
            recordingOwner: undefined,
        });
        touchActive.add('t1::gain');

        discardTouchAutomation('t1', 'gain');

        expect(pendingPoints.get('t1::gain')).toEqual([owned]);
        expect(pendingOwners.get('t1::gain')).toEqual([producer]);
        expect(activeRecording.get('t1::gain')?.lastValue).toBe(0.7);
        expect(touchActive.has('t1::gain')).toBe(true);
    });

    it.each(['read', 'off', 'touch', 'latch', 'write'] as const)(
        'gesture completion follows live %s mode without requiring another sample',
        (mode) => {
            const authority = captureTouchAutomationRecordingAuthority('t1', 'gain');
            activeRecording.set('t1::gain', {
                parameterId: 'gain',
                trackId: 't1',
                startBeat: 0,
                lastValue: 0.5,
                recordingOwner: authority.owner,
            });
            touchActive.add('t1::gain');
            trackSnapshot.value = { tracks: [{ id: 't1', automationMode: mode }] };

            authority.release();

            const keepsRecording = mode === 'latch' || mode === 'write';
            expect(flushPendingPoints).toHaveBeenCalledTimes(keepsRecording ? 0 : 1);
            expect(touchActive.has('t1::gain')).toBe(keepsRecording);
            expect(activeRecording.get('t1::gain')?.lastValue).toBe(keepsRecording ? 0.5 : null);
        }
    );

    it('leaves an absent session untouched (no throw) on release', () => {
        expect(() => releaseTouchAutomation('ghost', 'gain')).not.toThrow();
        expect(activeRecording.has('ghost::gain')).toBe(false);
    });
});
