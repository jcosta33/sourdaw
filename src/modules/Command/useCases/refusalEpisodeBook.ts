import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { isAppActionAdmitted } from './isAppActionAdmitted';
import { subscribeAppActionAdmissionChanges } from './subscribeAppActionAdmissionChanges';

export type OpenEpisode = { action: AppAction; projectIdentity: string };

export type RefusalEpisodeBook = {
    openRefused: (key: string, episode: OpenEpisode) => void;
    settleUncommitted: (key: string) => void;
    close: (key: string) => void;
    closeAll: () => void;
};

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

/** The open and delivering episodes of one `createUserAppActionRefusalEpisodes` set, keyed by caller key. */
export function createRefusalEpisodeBook(onAdmitted: ((key: string) => void) | undefined): RefusalEpisodeBook {
    const open = new Map<string, OpenEpisode>();
    /** Admitted episodes waiting for their deferred delivery; closing a key withdraws it. */
    const delivering = new Map<string, OpenEpisode>();
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
            for (const [key, episode] of admitted) {
                if (delivering.get(key) !== episode) {
                    continue;
                }
                delivering.delete(key);
                const verdict = readVerdict(episode);
                if (verdict === 'admitted') {
                    onAdmitted?.(key);
                } else if (verdict === 'refused') {
                    // Refused again before delivery: the episode never ended.
                    open.set(key, episode);
                }
            }
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
        openRefused(key, episode) {
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
        closeAll() {
            open.clear();
            delivering.clear();
            syncSubscription();
        },
    };
}
