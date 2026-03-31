import { type ReactElement } from 'react';

import { usePresence } from '../hooks/usePresence';

type PresenceOverlayProps = {
    /** Convert a beat position to pixel X offset in the timeline. */
    beatToX: (beat: number) => number;
    /** Convert a track ID to pixel Y offset in the timeline. */
    trackIdToY: (trackId: string) => number | null;
    /** Height of a single track row in pixels. */
    trackHeight: number;
};

/**
 * Renders collaborator presence indicators on top of the arrangement timeline.
 *
 * Shows:
 * - Colored vertical cursor lines at each peer's cursor position
 * - Colored name labels at the top of each cursor
 * - Small colored dots on track headers where a peer is focused
 */
export const PresenceOverlay = ({
    beatToX,
    trackIdToY,
    trackHeight,
}: PresenceOverlayProps): ReactElement => {
    const presenceMap = usePresence();

    return (
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            {Array.from(presenceMap.values()).map((presence) => {
                if (presence.cursorBeat === null) {
                    return null;
                }

                const x = beatToX(presence.cursorBeat);
                const trackY = presence.cursorTrackId
                    ? trackIdToY(presence.cursorTrackId)
                    : null;

                return (
                    <div key={presence.peerId}>
                        {/* Cursor line */}
                        <div
                            className="absolute top-0 bottom-0 w-px"
                            style={{
                                left: `${x}px`,
                                backgroundColor: presence.color,
                                opacity: 0.7,
                            }}
                        />

                        {/* Name label at top of cursor */}
                        <div
                            className="absolute rounded-b px-1 text-[9px] font-medium text-white whitespace-nowrap"
                            style={{
                                left: `${x + 2}px`,
                                top: 0,
                                backgroundColor: presence.color,
                                opacity: 0.9,
                            }}
                        >
                            {presence.name}
                        </div>

                        {/* Track focus dot */}
                        {trackY !== null ? (
                            <div
                                className="absolute size-2 rounded-full"
                                style={{
                                    left: `${x - 3}px`,
                                    top: `${trackY + trackHeight / 2 - 3}px`,
                                    backgroundColor: presence.color,
                                }}
                            />
                        ) : null}

                        {/* Selected clip highlights */}
                        {presence.selectedClipIds.map((clipId) => (
                            <div
                                key={clipId}
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    // Clip highlighting would need clip position data
                                    // which is available from the track store.
                                    // For now, this is a placeholder for the rendering hook.
                                }}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
};
