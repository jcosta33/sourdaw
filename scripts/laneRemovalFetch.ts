type FetchShell = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

const REMOTE_HEAD_PREFIX = 'refs/heads/';
const TRACKING_PREFIX = 'refs/remotes/origin/';

function remoteHeadsByTrackingRef(lsRemote: string): Map<string, string> {
    const heads = new Map<string, string>();
    for (const line of lsRemote.split('\n')) {
        const [objectName, refName] = line.split('\t');
        if (objectName === undefined || refName === undefined || !refName.startsWith(REMOTE_HEAD_PREFIX)) {
            continue;
        }
        heads.set(`${TRACKING_PREFIX}${refName.slice(REMOTE_HEAD_PREFIX.length)}`, objectName);
    }
    return heads;
}

function localTrackingRefs(forEachRef: string): Map<string, string> {
    const refs = new Map<string, string>();
    for (const line of forEachRef.split('\n')) {
        const [objectName, refName] = line.split(' ');
        if (objectName === undefined || refName === undefined || refName === `${TRACKING_PREFIX}HEAD`) {
            continue;
        }
        refs.set(refName, objectName);
    }
    return refs;
}

/**
 * A fetch that lost the compare-and-swap on a tracking ref to a concurrent fetch exits non-zero
 * although the ref holds the commit it wanted. The fetch's goal is that the tracking refs mirror
 * the remote heads exactly, so that state is checked instead of the exit status.
 */
export function trackingRefsMirrorRemoteHeads(lsRemote: string, forEachRef: string): boolean {
    const remote = remoteHeadsByTrackingRef(lsRemote);
    const local = localTrackingRefs(forEachRef);
    if (remote.size !== local.size) {
        return false;
    }
    for (const [refName, objectName] of remote) {
        if (local.get(refName) !== objectName) {
            return false;
        }
    }
    return true;
}

export function fetchOrAcceptCompletedFetch(shell: FetchShell): void {
    try {
        shell.run('git', ['fetch', '--prune', 'origin']);
    } catch (error) {
        const lsRemote = shell.capture('git', ['ls-remote', '--heads', 'origin']);
        const forEachRef = shell.capture('git', [
            'for-each-ref',
            '--format=%(objectname) %(refname)',
            'refs/remotes/origin/',
        ]);
        if (!trackingRefsMirrorRemoteHeads(lsRemote, forEachRef)) {
            throw error;
        }
    }
}
