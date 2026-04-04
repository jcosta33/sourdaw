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
                        {/* Ghost playhead — dashed line at peer's playhead position */}
                        {playheadX !== null ? (
                            <>
                                <div
                                    className="absolute top-0 bottom-0"
                                    style={{
                                        left: `${playheadX}px`,
                                        width: '1px',
                                        backgroundImage: `repeating-linear-gradient(to bottom, ${presence.color} 0px, ${presence.color} 4px, transparent 4px, transparent 8px)`,
                                        opacity: 0.6,
                                    }}
                                />
                                <div
                                    className="absolute rounded-b px-1 text-[9px] font-medium text-white whitespace-nowrap"
                                    style={{
                                        left: `${playheadX + 3}px`,
                                        bottom: 4,
                                        backgroundColor: presence.color,
                                        opacity: 0.75,
                                    }}
                                >
                                    {presence.name}
                                </div>
                            </>
                        ) : null}

                        {/* Cursor line */}
                        {cursorX !== null ? (
                            <>
                                <div
                                    className="absolute top-0 bottom-0 w-px"
                                    style={{
                                        left: `${cursorX}px`,
                                        backgroundColor: presence.color,
                                        opacity: 0.7,
                                    }}
                                />

                                {/* Name label at top of cursor */}
                                <div
                                    className="absolute rounded-b px-1 text-[9px] font-medium text-white whitespace-nowrap"
                                    style={{
                                        left: `${cursorX + 2}px`,
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
                                            left: `${cursorX - 3}px`,
                                            top: `${trackY + trackHeight / 2 - 3}px`,
                                            backgroundColor: presence.color,
                                        }}
                                    />
                                ) : null}
                            </>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
};
