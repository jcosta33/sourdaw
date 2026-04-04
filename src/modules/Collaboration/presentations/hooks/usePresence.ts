import { useState, useEffect, useRef } from 'react';

import { type PresenceData } from '../../models/CollaborationTypes';
import { onPresence } from '../../useCases/collaboration';

const PRESENCE_EXPIRY_MS = 5000;

/**
 * Subscribe to all peer presence data.
 * Returns a map of peerId -> latest PresenceData.
 * Entries expire after 5 seconds of no updates from that peer.
 */
export const usePresence = (): Map<string, PresenceData> => {
    const [presenceMap, setPresenceMap] = useState<Map<string, PresenceData>>(new Map());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    useEffect(() => {
        const unsubscribe = onPresence((data) => {
            setPresenceMap((prev) => {
                const next = new Map(prev);
                // Merge with existing entry so partial updates (e.g. playhead-only
                // broadcasts) don't wipe fields set by other update paths.
                const existing = next.get(data.peerId);
                next.set(data.peerId, existing ? { ...existing, ...data } : data);
                return next;
            });

            // Reset expiration timer for this peer
            const timers = timersRef.current;
            const existing = timers.get(data.peerId);
            if (existing) {
                clearTimeout(existing);
            }
            timers.set(data.peerId, setTimeout(() => {
                setPresenceMap((prev) => {
                    const next = new Map(prev);
                    next.delete(data.peerId);
                    return next;
                });
                timers.delete(data.peerId);
            }, PRESENCE_EXPIRY_MS));
        });

        return () => {
            unsubscribe();
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer);
            }
            timersRef.current.clear();
        };
    }, []);

    return presenceMap;
};
