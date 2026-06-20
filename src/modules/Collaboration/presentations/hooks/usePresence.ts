import { useEffect, useRef, useState } from 'react';

import { type PresenceDelta } from '../../models/CollaborationTypes';
import { onPresence } from '../../useCases/collaboration/sessionManagement';
import { type PresenceData } from '../../useCases/collaborationQueries';

const PRESENCE_EXPIRY_MS = 5000;

/**
 * Seed a complete PresenceData record for a peer we've not seen before, using
 * the identity carried by the first delta. Subsequent deltas merge onto this,
 * so the overlay always reads fully-defined fields (never `undefined` from an
 * omitted delta field).
 */
function seedPresence(delta: PresenceDelta): PresenceData {
    return {
        peerId: delta.peerId,
        name: delta.name,
        color: delta.color,
        view: delta.view ?? 'arrangement',
        cursorBeat: delta.cursorBeat ?? null,
        cursorTrackId: delta.cursorTrackId ?? null,
        selectedClipIds: delta.selectedClipIds ?? [],
        selectedNoteIds: delta.selectedNoteIds ?? [],
        viewportStartBeat: delta.viewportStartBeat ?? 0,
        viewportEndBeat: delta.viewportEndBeat ?? 0,
        viewportTrackIds: delta.viewportTrackIds ?? [],
        action: delta.action ?? null,
        playheadBeat: delta.playheadBeat ?? null,
    };
}

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
            // Merge the delta onto the existing record so partial updates (e.g.
            // the playhead-only heartbeat or a cursor-only broadcast) preserve
            // fields owned by the other path. A peer's first delta seeds a
            // complete record so every field stays defined. `{ ...existing,
            // ...data }` is safe here because a delta omits (rather than nulls)
            // the fields it doesn't own.
            const existing = dataRef.current[data.peerId];
            dataRef.current[data.peerId] = existing ? { ...existing, ...data } : seedPresence(data);
            setVersion((value) => value + 1);

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
                    setVersion((value) => value + 1);
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
    // across renders with the same version. Reading `dataRef.current` here
    // is intentional: `version` ensures React re-renders only when data changes,
    // while the ref avoids stale-closure issues in the subscription callback.
    void version;
    // eslint-disable-next-line react-hooks/refs -- intentional version-counter pattern: ref stores mutable presence map, state version triggers re-render
    return Object.values(dataRef.current);
};
