import { type ReactElement } from 'react';

import { PresenceMarker } from '../components/PresenceMarker';
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
 * - Dashed ghost playhead lines at each peer's current playhead position
 * - Solid cursor lines at each peer's mouse cursor position
 * - Name labels and track focus dots alongside cursor lines
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
                const playheadX = presence.playheadBeat !== null
                    ? beatToX(presence.playheadBeat)
                    : null;
                const cursorX = presence.cursorBeat !== null
                    ? beatToX(presence.cursorBeat)
                    : null;
                const trackY = presence.cursorTrackId
                    ? trackIdToY(presence.cursorTrackId)
                    : null;

                return (
                    <div key={presence.peerId}>
                        {playheadX !== null ? (
                            <PresenceMarker
                                name={presence.name}
                                color={presence.color}
                                left={playheadX}
                                variant="playhead"
                            />
                        ) : null}

                        {cursorX !== null ? (
                            <PresenceMarker
                                name={presence.name}
                                color={presence.color}
                                left={cursorX}
                                variant="cursor"
                                trackDotY={trackY !== null ? trackY + trackHeight / 2 : null}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
};
