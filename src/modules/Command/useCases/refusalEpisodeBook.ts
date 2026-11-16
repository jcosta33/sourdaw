import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { isAppActionAdmitted } from './isAppActionAdmitted';
import { subscribeAppActionAdmissionChanges } from './subscribeAppActionAdmissionChanges';

/**
 * What the book records when a dispatch starts. `endMark` is the key's end mark then: a different
 * mark later means the caller ended the key since. `order` ranks the dispatch among every dispatch
 * of the set, so a commit can tell whether a refusal started after it.
 */
export type DispatchStart = { endMark: string; order: number };

export type OpenEpisode = DispatchStart & { action: AppAction; projectIdentity: string };

export type RefusalEpisodeBook = {
    beginDispatch: (key: string) => DispatchStart;
    openRefused: (key: string, episode: OpenEpisode) => void;
    settleUncommitted: (key: string) => void;
    /** Called the moment a dispatch commits, before it resolves, so a refusal or delivery in between sees it. */
    closeCommitted: (key: string, order: number) => void;
    end: (key: string) => void;
    endAll: () => void;
};

/** An episode as the book holds it: `warned` records whether its user was told the edit is unsaved. */
type HeldEpisode = OpenEpisode & { warned: boolean };

type EndMarks = { markOf: (key: string) => string; end: (key: string) => void; endAll: () => void };

/** Counts the caller's ends per key, so a dispatch can tell it outlived its key. */
function createEndMarks(): EndMarks {
    let endAllCount = 0;
    const endCounts = new Map<string, number>();
    return {
        markOf: (key: string) => `${endAllCount}:${endCounts.get(key) ?? 0}`,
        end(key: string) {
            endCounts.set(key, (endCounts.get(key) ?? 0) + 1);
        },
        endAll() {
            endAllCount += 1;
            endCounts.clear();
        },
    };
}

type CommittedOrders = {
    record: (key: string, order: number) => void;
    supersedes: (key: string, order: number) => boolean;
    forget: (key: string) => void;
    forgetAll: () => void;
};

/** The latest committed dispatch per key, so a refusal can tell a newer edit already reached the project. */
function createCommittedOrders(): CommittedOrders {
    const latest = new Map<string, number>();
    return {
        record(key, order) {
            latest.set(key, Math.max(order, latest.get(key) ?? 0));
        },
        supersedes: (key, order) => (latest.get(key) ?? 0) > order,
        forget(key) {
            latest.delete(key);
        },
        forgetAll() {
            latest.clear();
        },
    };
}

/** Where an open episode stands now: replaced project, admitted again, or still refused. */
function readVerdict(episode: OpenEpisode): 'stale' | 'admitted' | 'refused' {
    if (episode.projectIdentity !== captureProjectIdentity()) {
        return 'stale';
    }
    return isAppActionAdmitted(episode.action) ? 'admitted' : 'refused';
}

function warnRefused(action: AppAction): void {
    notifyUser(
        `${describeAppActionRefusal(action.type)} Further edits to this device are not saved until the project can be changed.`,
        'warning'
    );
}

/** The episode now refused, with its user told about it exactly once per episode. */
function holdRefused(episode: OpenEpisode, warned: boolean): HeldEpisode {
    if (!warned) {
        warnRefused(episode.action);
    }
    return { ...episode, warned: true };
}

type EpisodeMaps = { open: Map<string, HeldEpisode>; delivering: Map<string, HeldEpisode> };

/** Moves every open episode the gate now admits to delivery and drops the stale ones; returns the admitted. */
function takeAdmitted(maps: EpisodeMaps): [string, HeldEpisode][] {
    const admitted: [string, HeldEpisode][] = [];
    for (const [key, episode] of maps.open) {
        const verdict = readVerdict(episode);
        if (verdict === 'refused') {
            continue;
        }
        maps.open.delete(key);
        if (verdict === 'admitted') {
            maps.delivering.set(key, episode);
            admitted.push([key, episode]);
        }
    }
    return admitted;
}

/** Delivers each admitted episode no close has withdrawn since, reopening one the gate refuses again. */
function runDeliveries(
    maps: EpisodeMaps,
    admitted: [string, HeldEpisode][],
    onAdmitted: ((key: string) => void) | undefined
): void {
    for (const [key, episode] of admitted) {
        if (maps.delivering.get(key) !== episode) {
            continue;
        }
        maps.delivering.delete(key);
        const verdict = readVerdict(episode);
        if (verdict === 'admitted') {
            onAdmitted?.(key);
        } else if (verdict === 'refused') {
            // Refused again before delivery: the episode never ended.
            maps.open.set(key, holdRefused(episode, episode.warned));
        }
    }
}

/** The open and delivering episodes of one `createUserAppActionRefusalEpisodes` set, keyed by caller key. */
export function createRefusalEpisodeBook(onAdmitted: ((key: string) => void) | undefined): RefusalEpisodeBook {
    const open = new Map<string, HeldEpisode>();
    /** Admitted episodes waiting for their deferred delivery; closing a key withdraws it. */
    const delivering = new Map<string, HeldEpisode>();
    const endMarks = createEndMarks();
    const committedOrders = createCommittedOrders();
    let dispatchCount = 0;
    let unsubscribe: (() => void) | null = null;

    function syncSubscription(): void {
        if (open.size === 0) {
            unsubscribe?.();
            unsubscribe = null;
            return;
        }
        unsubscribe ??= subscribeAppActionAdmissionChanges(closeAdmittedEpisodes);
    }

    function deliverAdmitted(admitted: [string, HeldEpisode][]): void {
        queueMicrotask(() => {
            runDeliveries({ open, delivering }, admitted, onAdmitted);
            syncSubscription();
        });
    }

    function closeAdmittedEpisodes(): void {
        const admitted = takeAdmitted({ open, delivering });
        syncSubscription();
        if (admitted.length > 0) {
            deliverAdmitted(admitted);
        }
    }

    function close(key: string): void {
        open.delete(key);
        delivering.delete(key);
        syncSubscription();
    }

    return {
        beginDispatch(key) {
            dispatchCount += 1;
            return { endMark: endMarks.markOf(key), order: dispatchCount };
        },
        openRefused(key, episode) {
            // A key the caller ended while this dispatch was in flight left the session; nothing is refused for it.
            if (episode.endMark !== endMarks.markOf(key)) {
                return;
            }
            // A newer edit on the key already committed, so the session state this edit set is saved.
            if (committedOrders.supersedes(key, episode.order)) {
                return;
            }
            const verdict = readVerdict(episode);
            if (verdict === 'stale') {
                return;
            }
            // A key awaiting delivery was never seen admitted by anyone, so it is still the same episode.
            const previous = open.get(key) ?? delivering.get(key);
            const samePrevious = previous?.projectIdentity === episode.projectIdentity ? previous : undefined;
            if (samePrevious && samePrevious.order > episode.order) {
                // A late refusal from an older dispatch: the held episode already stands for the newer edit.
                return;
            }
            const warned = samePrevious?.warned ?? false;
            delivering.delete(key);
            if (verdict === 'admitted') {
                // The gate changed between the refusal and this handler, so no signal reached the episode.
                open.set(key, { ...episode, warned });
                closeAdmittedEpisodes();
                return;
            }
            open.set(key, holdRefused(episode, warned));
            syncSubscription();
        },
        settleUncommitted(key) {
            const episode = open.get(key);
            if (!episode) {
                return;
            }
            const verdict = readVerdict(episode);
            if (verdict === 'refused') {
                return;
            }
            close(key);
            if (verdict === 'admitted') {
                onAdmitted?.(key);
            }
        },
        closeCommitted(key, order) {
            committedOrders.record(key, order);
            // A refusal that started after this commit refused a newer edit, which is still unsaved.
            const episode = open.get(key) ?? delivering.get(key);
            if (episode && episode.order > order) {
                return;
            }
            close(key);
        },
        end(key) {
            endMarks.end(key);
            committedOrders.forget(key);
            close(key);
        },
        endAll() {
            endMarks.endAll();
            committedOrders.forgetAll();
            open.clear();
            delivering.clear();
            syncSubscription();
        },
    };
}
