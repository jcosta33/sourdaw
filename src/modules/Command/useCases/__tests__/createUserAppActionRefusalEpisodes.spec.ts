import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionAdmissionRefusedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { createUserAppActionRefusalEpisodes } from '../createUserAppActionRefusalEpisodes';
import { executeAppAction } from '../executeAppAction';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

vi.mock('../executeAppAction', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../executeAppAction')>()),
    executeAppAction: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const action = { type: 'addTrack', payload: { name: 'New track', kind: 'audio' } } as const;
const refuse = () => vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionAdmissionRefusedError('addTrack'));

/** Resolves once every microtask queued so far has run. */
const afterMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createUserAppActionRefusalEpisodes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(executeAppAction).mockImplementation(async (_action, options) => {
            options?.onCommitted?.();
        });
    });

    describe('while the project stays locked', () => {
        // A refusal comes from a gate that refuses; one that admits by then is the race the
        // 'when the project becomes changeable' cases cover.
        beforeEach(() => {
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));
        });

        afterEach(() => {
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        });

        it('notifies once for a sweep of refused executes on one key', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            for (let step = 0; step < 20; step++) {
                refuse();
                await expect(episodes.execute('device-1', action)).resolves.toBe('refused');
            }

            expect(notifyUser).toHaveBeenCalledTimes(1);
            expect(notifyUser).toHaveBeenCalledWith(
                "Add track was refused because the project can't be changed right now. Further edits to this device are not saved until the project can be changed.",
                'warning'
            );
        });

        it('notifies again for a refusal after a successful execute on that key', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            refuse();
            await episodes.execute('device-1', action);
            await episodes.execute('device-1', action);
            refuse();
            await episodes.execute('device-1', action);

            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('starts a new episode after end(key)', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            refuse();
            await episodes.execute('device-1', action);
            episodes.end('device-1');
            refuse();
            await episodes.execute('device-1', action);

            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('starts new episodes for every key after endAll()', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            refuse();
            await episodes.execute('device-1', action);
            refuse();
            await episodes.execute('device-2', action);
            episodes.endAll();
            refuse();
            await episodes.execute('device-1', action);
            refuse();
            await episodes.execute('device-2', action);

            expect(notifyUser).toHaveBeenCalledTimes(4);
        });

        it('keeps one key episode independent of another', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            refuse();
            await episodes.execute('device-1', action);
            refuse();
            await episodes.execute('device-2', action);
            refuse();
            await episodes.execute('device-1', action);
            // A success on device-2 ends only device-2's episode.
            await episodes.execute('device-2', action);
            refuse();
            await episodes.execute('device-1', action);

            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('rejects a plain conflict unchanged, notifies nothing and opens no episode', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            const conflict = new AppActionConflictError('addTrack');
            vi.mocked(executeAppAction).mockRejectedValueOnce(conflict);

            await expect(episodes.execute('device-1', action)).rejects.toBe(conflict);
            expect(notifyUser).not.toHaveBeenCalled();

            refuse();
            await episodes.execute('device-1', action);
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });

        it('rejects a non-conflict failure unchanged and notifies nothing', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            const failure = new Error('disk full');
            vi.mocked(executeAppAction).mockRejectedValueOnce(failure);

            await expect(episodes.execute('device-1', action)).rejects.toBe(failure);
            expect(notifyUser).not.toHaveBeenCalled();
        });
    });

    describe('when the project becomes changeable', () => {
        const lock = () =>
            agentProjectRepairStateStore.set({
                audioGraphValid: false,
                detectedRevision: 'revision-1',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [],
                status: 'repair-required',
            });
        const unlock = () => agentProjectRepairStateStore.set(null);

        afterEach(() => {
            agentProjectRepairStateStore.set(null);
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
            productionBriefAdmissionPort.setSubscription(() => () => undefined);
        });

        it('closes the episode and reports the key once when the repair gate clears', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            unlock();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');

            lock();
            unlock();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledTimes(1);
        });

        it('warns again for a refusal after the project was unlocked and relocked', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);
            unlock();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
            lock();
            refuse();
            await episodes.execute('A', action);

            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('stays open and silent while an admission signal leaves the key refused', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            // A different gate state change that still refuses the action.
            agentProjectRepairStateStore.set({
                ...agentProjectRepairStateStore.value!,
                detectedRevision: 'revision-2',
            });
            refuse();
            await episodes.execute('A', action);

            expect(onAdmitted).not.toHaveBeenCalled();
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });

        it('ends only the keys whose last action is admitted now', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            const other = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
            let briefLocksRemoval = true;
            productionBriefAdmissionPort.setGuard((actions) => ({
                allowsCurrent: () =>
                    !(briefLocksRemoval && actions.some((candidate) => candidate.type === 'removeTrack')),
            }));
            let signalBrief = () => {};
            productionBriefAdmissionPort.setSubscription((listener) => {
                signalBrief = listener;
                return () => undefined;
            });
            lock();
            vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionAdmissionRefusedError('addTrack'));
            await episodes.execute('A', action);
            vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionAdmissionRefusedError('removeTrack'));
            await episodes.execute('B', other);

            unlock();
            await afterMicrotasks();
            expect(onAdmitted.mock.calls).toEqual([['A']]);

            briefLocksRemoval = false;
            signalBrief();
            await afterMicrotasks();
            expect(onAdmitted.mock.calls).toEqual([['A'], ['B']]);
        });

        it('reports a key when the production brief starts admitting its action', async () => {
            const onAdmitted = vi.fn();
            let allowed = false;
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => allowed }));
            let signalBrief = () => {};
            productionBriefAdmissionPort.setSubscription((listener) => {
                signalBrief = listener;
                return () => undefined;
            });
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            refuse();
            await episodes.execute('A', action);

            signalBrief();
            expect(onAdmitted).not.toHaveBeenCalled();
            allowed = true;
            signalBrief();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
        });

        it('drops an episode without reporting it when the project was replaced before the repair state cleared', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            // A load installs the new root, then clears the repair state, in this order.
            resetCrdtProjectAuthority('Replacement');

            expect(agentProjectRepairStateStore.value).toBeNull();
            await afterMicrotasks();
            expect(onAdmitted).not.toHaveBeenCalled();
            // The dropped episode is gone: a refusal in the new project warns afresh.
            lock();
            refuse();
            await episodes.execute('A', action);
            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('keeps an episode open when a dispatch resolves without committing while still refused', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await expect(episodes.execute('A', action)).resolves.toBe('refused');

            vi.mocked(executeAppAction).mockResolvedValueOnce(undefined);
            await expect(episodes.execute('A', action)).resolves.toBe('skipped');
            expect(onAdmitted).not.toHaveBeenCalled();

            unlock();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
        });

        it('reports a key whose action became admitted when a non-committing dispatch resolves', async () => {
            const onAdmitted = vi.fn();
            let allowed = false;
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => allowed }));
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            refuse();
            await episodes.execute('A', action);

            // No admission signal reaches the episode: only the resolve can notice.
            allowed = true;
            vi.mocked(executeAppAction).mockResolvedValueOnce(undefined);
            await expect(episodes.execute('A', action)).resolves.toBe('skipped');

            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
        });

        it('still calls the caller onCommitted and ends the episode on a committed dispatch', async () => {
            const episodes = createUserAppActionRefusalEpisodes();
            const onCommitted = vi.fn();
            lock();
            refuse();
            await episodes.execute('A', action);

            unlock();
            await expect(episodes.execute('A', action, { onCommitted })).resolves.toBe('committed');
            expect(onCommitted).toHaveBeenCalledTimes(1);

            // The episode ended: the next refusal on the key warns afresh.
            lock();
            refuse();
            await episodes.execute('A', action);
            expect(notifyUser).toHaveBeenCalledTimes(2);
        });

        it('reports a key when a later refused action is admitted after the first stays refused', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            const first = { type: 'removeTrack', payload: { trackId: 'track-1' } } as const;
            productionBriefAdmissionPort.setGuard((actions) => ({
                allowsCurrent: () => !actions.some((candidate) => candidate.type === 'removeTrack'),
            }));
            lock();
            vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionAdmissionRefusedError('removeTrack'));
            await episodes.execute('A', first);
            refuse();
            await episodes.execute('A', action);

            unlock();
            await afterMicrotasks();

            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
        });

        it('delivers an admitted key after the synchronous change that unlocked the project, not during it', async () => {
            const delivered: string[] = [];
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted: (key) => delivered.push(key) });
            lock();
            refuse();
            await episodes.execute('A', action);

            // One synchronous pass: the unlock signal, then the device state the same merge changed.
            unlock();
            delivered.push('device-state-change');

            await afterMicrotasks();
            expect(delivered).toEqual(['device-state-change', 'A']);
        });

        it('does not deliver a key whose project was replaced between the signal and the delivery', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            unlock();
            resetCrdtProjectAuthority('Replacement');
            await afterMicrotasks();

            expect(onAdmitted).not.toHaveBeenCalled();
        });

        it('delivers a key whose project became changeable before its refusal reached the episode', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            vi.mocked(executeAppAction).mockImplementationOnce(async () => {
                // The repair clears after the gate refused, before the refusal is handled.
                queueMicrotask(unlock);
                throw new AppActionAdmissionRefusedError('addTrack');
            });

            await expect(episodes.execute('A', action)).resolves.toBe('refused');
            await afterMicrotasks();

            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
            // The project admits the edit and it is written: nothing to warn about.
            expect(notifyUser).not.toHaveBeenCalled();
        });

        it('keeps the episode open when the project unlocks and relocks before delivery', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            // Two gate transitions in one synchronous task, before the delivery microtask runs.
            unlock();
            lock();
            await afterMicrotasks();
            expect(onAdmitted).not.toHaveBeenCalled();

            // Still the same episode: a further refusal stays silent.
            refuse();
            await episodes.execute('A', action);
            expect(notifyUser).toHaveBeenCalledTimes(1);

            unlock();
            await afterMicrotasks();
            expect(onAdmitted).toHaveBeenCalledExactlyOnceWith('A');
        });

        it('stays silent for a refusal that lands while the key awaits delivery', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            // The second refusal is handled after the unlock signal and before its delivery.
            refuse();
            const refused = episodes.execute('A', action);
            unlock();
            lock();
            await expect(refused).resolves.toBe('refused');
            await afterMicrotasks();

            expect(notifyUser).toHaveBeenCalledTimes(1);
            expect(onAdmitted).not.toHaveBeenCalled();
        });

        it('does not deliver a key that was ended between the signal and the delivery', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            refuse();
            await episodes.execute('A', action);

            unlock();
            episodes.end('A');
            await afterMicrotasks();

            expect(onAdmitted).not.toHaveBeenCalled();
        });

        it('opens no episode for a refusal whose project was replaced while it was dispatched', async () => {
            const onAdmitted = vi.fn();
            const episodes = createUserAppActionRefusalEpisodes({ onAdmitted });
            lock();
            vi.mocked(executeAppAction).mockImplementationOnce(async () => {
                resetCrdtProjectAuthority('Replacement');
                lock();
                throw new AppActionAdmissionRefusedError('addTrack');
            });

            await expect(episodes.execute('A', action)).resolves.toBe('refused');
            expect(notifyUser).not.toHaveBeenCalled();

            unlock();
            await afterMicrotasks();
            expect(onAdmitted).not.toHaveBeenCalled();
        });

        it('holds the brief subscription only while an episode is open', async () => {
            const unsubscribe = vi.fn();
            const subscribe = vi.fn(() => unsubscribe);
            productionBriefAdmissionPort.setSubscription(subscribe);
            const episodes = createUserAppActionRefusalEpisodes();
            expect(subscribe).not.toHaveBeenCalled();

            lock();
            refuse();
            await episodes.execute('A', action);
            refuse();
            await episodes.execute('B', action);
            expect(subscribe).toHaveBeenCalledTimes(1);

            await episodes.execute('A', action);
            expect(unsubscribe).not.toHaveBeenCalled();
            episodes.end('B');
            expect(unsubscribe).toHaveBeenCalledTimes(1);

            refuse();
            await episodes.execute('C', action);
            expect(subscribe).toHaveBeenCalledTimes(2);
            episodes.endAll();
            expect(unsubscribe).toHaveBeenCalledTimes(2);

            refuse();
            await episodes.execute('D', action);
            unlock();
            expect(unsubscribe).toHaveBeenCalledTimes(3);
        });
    });
});
