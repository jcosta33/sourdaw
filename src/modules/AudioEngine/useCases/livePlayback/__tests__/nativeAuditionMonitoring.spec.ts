import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphApplyResult, type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { stoppedEngineTransportPosition } from '../../../models/EngineTransportPosition';
import { getEngineTransportPosition } from '../../../repositories/engineTransport/getEngineTransportPosition';
import { nativeLiveGraphSessionOffered } from '../nativeLiveGraphSessionOffered';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { reconcileNativeAuditionMonitoring } from '../reconcileNativeAuditionMonitoring';

vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
vi.mock('../nativeLiveGraphSessionOffered', () => ({ nativeLiveGraphSessionOffered: vi.fn(() => true) }));
vi.mock('../reportAttachedPlugins', () => ({ reportAttachedPlugins: vi.fn() }));

const ORIGINAL = 'dc0f62d1-dc26-4c5c-81db-36130c1466e4:0';
const REPLACEMENT = 'dc0f62d1-dc26-4c5c-81db-36130c1466e4:1';

function applied(): AudioGraphApplyResult {
    return {
        acceptance: 'accepted',
        application: 'applied',
        runtimeRevision: 1,
        engineIncarnation: ORIGINAL,
        admittedBatch: 42,
        reports: [],
    };
}

function installBackend() {
    const apply = vi.fn<AudioGraphBackend['apply']>().mockResolvedValue(applied());
    nativeLiveGraphSession.backend = { backendId: 'native/live', apply, dispose: vi.fn() };
    return apply;
}

describe('native audition output readiness', () => {
    beforeEach(() => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        vi.mocked(getEngineTransportPosition).mockReset();
        Object.assign(nativeLiveGraphSession, {
            backend: null,
            orphanedBackend: null,
            startsPending: 0,
            programmeCarrier: true,
            audibleCarrier: true,
            monitorShadowed: false,
            auditionOwner: Symbol('audition'),
            auditionOutputSuppressed: false,
            auditionEpoch: 0,
            auditionInvalidation: null,
            pending: Promise.resolve(),
        });
    });

    it('waits for the exact engine fence through fresh queued position reads', async () => {
        const apply = installBackend();
        let publish: (value: Awaited<ReturnType<typeof getEngineTransportPosition>>) => void = () => {};
        const fresh = new Promise<Awaited<ReturnType<typeof getEngineTransportPosition>>>((resolve) => {
            publish = resolve;
        });
        vi.mocked(getEngineTransportPosition)
            .mockResolvedValueOnce({
                ...stoppedEngineTransportPosition,
                running: true,
                engineIncarnation: ORIGINAL,
                batchesApplied: 41,
            })
            .mockReturnValueOnce(fresh);
        const ready = reconcileNativeAuditionMonitoring({
            signal: new AbortController().signal,
            isCurrent: () => true,
        });
        await vi.waitFor(() => expect(getEngineTransportPosition).toHaveBeenCalledTimes(2));
        expect(nativeLiveGraphSession.audibleCarrier).toBe(true);
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [{ kind: 'set-monitor-shadow', shadowed: true }],
        });
        publish({ ...stoppedEngineTransportPosition, running: true, engineIncarnation: ORIGINAL, batchesApplied: 42 });
        const witness = await ready;
        expect(witness.isCurrent()).toBe(true);
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
        expect(nativeLiveGraphSession.programmeCarrier).toBe(true);
    });

    it('a replacement engine at batch900 cannot satisfy the old engine fence42', async () => {
        installBackend();
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: REPLACEMENT,
            batchesApplied: 900,
        });
        await expect(
            reconcileNativeAuditionMonitoring({ signal: new AbortController().signal, isCurrent: () => true })
        ).rejects.toThrow('engine changed or stopped');
        expect(nativeLiveGraphSession.auditionOutputSuppressed).toBe(false);
    });

    it('refuses a legacy applied answer before reading any supposed drain', async () => {
        const apply = installBackend();
        apply.mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            admittedBatch: 42,
            reports: [],
        });
        await expect(
            reconcileNativeAuditionMonitoring({ signal: new AbortController().signal, isCurrent: () => true })
        ).rejects.toThrow('exact engine identity');
        expect(getEngineTransportPosition).not.toHaveBeenCalled();
    });

    it('accepts modern no-handle but never equates omitted legacy witness with no engine', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(stoppedEngineTransportPosition);
        await expect(
            reconcileNativeAuditionMonitoring({ signal: new AbortController().signal, isCurrent: () => true })
        ).rejects.toThrow('empty output slot');
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            engineIncarnation: null,
        });
        const witness = await reconcileNativeAuditionMonitoring({
            signal: new AbortController().signal,
            isCurrent: () => true,
        });
        expect(witness.isCurrent()).toBe(true);
    });

    it('restores the current base monitor mode only after its own witnessed fence', async () => {
        const apply = installBackend();
        nativeLiveGraphSession.auditionOwner = null;
        nativeLiveGraphSession.auditionOutputSuppressed = true;
        nativeLiveGraphSession.audibleCarrier = false;
        vi.mocked(getEngineTransportPosition).mockResolvedValue({
            ...stoppedEngineTransportPosition,
            running: true,
            engineIncarnation: ORIGINAL,
            batchesApplied: 42,
        });
        await reconcileNativeAuditionMonitoring({ signal: new AbortController().signal, isCurrent: () => true });
        expect(apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [{ kind: 'set-monitor-shadow', shadowed: false }],
        });
        expect(nativeLiveGraphSession.audibleCarrier).toBe(true);
        expect(nativeLiveGraphSession.auditionOutputSuppressed).toBe(false);
    });

    it('restoration follows only known session transitions within one original absolute deadline', async () => {
        let now = 0;
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        const apply = installBackend();
        nativeLiveGraphSession.auditionOwner = null;
        const open = vi.fn();
        apply.mockImplementation(async () => {
            nativeLiveGraphSession.auditionEpoch += 1;
            now += 1_900;
            return applied();
        });
        try {
            await expect(
                reconcileNativeAuditionMonitoring({
                    signal: new AbortController().signal,
                    isCurrent: () => true,
                    restoreWebProgramme: open,
                })
            ).rejects.toThrow('timed out');
            expect(apply).toHaveBeenCalledTimes(2);
            expect(open).not.toHaveBeenCalled();
        } finally {
            clock.mockRestore();
        }
    });

    it('restoration never follows a rejected native apply merely because a session transition also occurred', async () => {
        const apply = installBackend();
        nativeLiveGraphSession.auditionOwner = null;
        const open = vi.fn();
        apply.mockImplementation(async () => {
            nativeLiveGraphSession.auditionEpoch += 1;
            return { acceptance: 'rejected', application: 'not-applied', reason: 'native-refused' };
        });
        await expect(
            reconcileNativeAuditionMonitoring({
                signal: new AbortController().signal,
                isCurrent: () => true,
                restoreWebProgramme: open,
            })
        ).rejects.toThrow('did not apply');
        expect(apply).toHaveBeenCalledTimes(1);
        expect(open).not.toHaveBeenCalled();
    });

    it('a browser needs no native readiness call', async () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);
        const witness = await reconcileNativeAuditionMonitoring({
            signal: new AbortController().signal,
            isCurrent: () => true,
        });
        expect(witness.isCurrent()).toBe(true);
        expect(getEngineTransportPosition).not.toHaveBeenCalled();
    });
});
