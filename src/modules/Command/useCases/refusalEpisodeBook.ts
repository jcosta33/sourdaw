import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { isAppActionAdmitted } from './isAppActionAdmitted';
import { subscribeAppActionAdmissionChanges } from './subscribeAppActionAdmissionChanges';

/** `endMark` is the key's `endMarkOf` when its dispatch started; a different mark now means the caller ended the key since. */
export type OpenEpisode = { action: AppAction; projectIdentity: string; endMark: string };

export type RefusalEpisodeBook = {
    endMarkOf: (key: string) => string;
    openRefused: (key: string, episode: OpenEpisode) => void;
    settleUncommitted: (key: string) => void;
    close: (key: string) => void;
    end: (key: string) => void;
    endAll: () => void;
};

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

/** Where an open episode stands now: replaced project, admitted again, or still refused. */
function readVerdict(episode: OpenEpisode): 'stale' | 'admitted' | 'refused' {
    if (episode.projectIdentity !== captureProjectIdentity()) {
        return 'stale';
    }
    return isAppActionAdmitted(episode.action) ? 'admitted' : 'refused';
}

type EpisodeMaps = { open: Map<string, OpenEpisode>; delivering: Map<string, OpenEpisode> };

/** Delivers each admitted episode no close has withdrawn since, reopening one the gate refuses again. */
function runDeliveries(
    maps: EpisodeMaps,
    admitted: [string, OpenEpisode][],
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
            maps.open.set(key, episode);
        }
    }
}

function warnRefused(action: AppAction): void {
    notifyUser(
        `${describeAppActionRefusal(action.type)} Further edits to this device are not saved until the project can be changed.`,
        'warning'
    );
}

/** The open and delivering episodes of one `createUserAppActionRefusalEpisodes` set, keyed by caller key. */
export function createRefusalEpisodeBook(onAdmitted: ((key: string) => void) | undefined): RefusalEpisodeBook {
    const open = new Map<string, OpenEpisode>();
    /** Admitted episodes waiting for their deferred delivery; closing a key withdraws it. */
    const delivering = new Map<string, OpenEpisode>();
    const endMarks = createEndMarks();
    let unsubscribe: (() => void) | null = null;

    function syncSubscription(): void {
        if (open.size === 0) {
            unsubscribe?.();
            unsubscribe = null;
            return;
        }
        unsubscribe ??= subscribeAppActionAdmissionChanges(closeAdmittedEpisodes);
    }

    function deliverAdmitted(admitted: [string, OpenEpisode][]): void {
        queueMicrotask(() => {
            runDeliveries({ open, delivering }, admitted, onAdmitted);
            syncSubscription();
        });
    }

    function closeAdmittedEpisodes(): void {
        const admitted: [string, OpenEpisode][] = [];
        for (const [key, episode] of open) {
            const verdict = readVerdict(episode);
            if (verdict === 'refused') {
                continue;
            }
            open.delete(key);
            if (verdict === 'admitted') {
                delivering.set(key, episode);
                admitted.push([key, episode]);
            }
        }
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
        endMarkOf: endMarks.markOf,
        openRefused(key, episode) {
            // A key the caller ended while this dispatch was in flight left the session; nothing is refused for it.
            if (episode.endMark !== endMarks.markOf(key)) {
                return;
            }
            const verdict = readVerdict(episode);
            if (verdict === 'stale') {
                return;
            }
            // A key awaiting delivery was never seen admitted by anyone, so it is still the same episode.
            const previous = open.get(key) ?? delivering.get(key);
            const alreadyOpen = previous?.projectIdentity === episode.projectIdentity;
            delivering.delete(key);
            open.set(key, episode);
            if (verdict === 'admitted') {
                // The gate changed between the refusal and this handler, so no signal reached the episode.
                closeAdmittedEpisodes();
                return;
            }
            syncSubscription();
            if (!alreadyOpen) {
                warnRefused(episode.action);
            }
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
        close,
        end(key) {
            endMarks.end(key);
            close(key);
        },
        endAll() {
            endMarks.endAll();
            open.clear();
            delivering.clear();
            syncSubscription();
        },
    };
}
