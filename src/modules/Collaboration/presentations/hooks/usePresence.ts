import { useEffect, useRef, useState } from 'react';

import { type PresenceData } from '../../useCases/collaborationQueries';
import { onPresence } from '../../useCases/collaboration/sessionManagement';

const PRESENCE_EXPIRY_MS = 5000;

/**
 * Subscribe to all peer presence data.
 * Returns an array of the latest PresenceData per peer. Entries expire
 * after 5 seconds of no updates from that peer.
 *
 * §151.1 — Previously this hook held a `Map<string, PresenceData>` in
 * React state and cloned the whole Map on every peer heartbeat
 * (5 peers × 10 Hz ≈ 50 Map clones/sec). The new shape mutates a
 * ref-backed plain object in place and only bumps a version counter
 * in state to trigger re-renders; we rebuild the output array lazily
 * once per version. Consumers only need `.values()` semantics — the
 * array shape is simpler and faster to iterate.
 */
export const usePresence = (): readonly PresenceData[] => {
    const dataRef = useRef<Record<string, PresenceData>>({});
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const unsubscribe = onPresence((data) => {
            // Merge with existing entry so partial updates (e.g. playhead-only
            // broadcasts) don't wipe fields set by other update paths.
            const existing = dataRef.current[data.peerId];
            dataRef.current[data.peerId] = existing ? { ...existing, ...data } : data;
            setVersion((v) => v + 1);

            // Reset expiration timer for this peer
            const timers = timersRef.current;
            const prevTimer = timers.get(data.peerId);
            if (prevTimer) {
                clearTimeout(prevTimer);
            }
            timers.set(
                data.peerId,
                setTimeout(() => {
                    delete dataRef.current[data.peerId];
                    timers.delete(data.peerId);
                    setVersion((v) => v + 1);
                }, PRESENCE_EXPIRY_MS)
            );
        });

        return () => {
            unsubscribe();
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer);
            }
            timersRef.current.clear();
            dataRef.current = {};
        };
    }, []);

    // Rebuild once per version bump. The React Compiler memoizes this
    // across renders with the same version.
    void version;
    return Object.values(dataRef.current);
};
