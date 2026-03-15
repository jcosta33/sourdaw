import { type ReactElement } from "react";
import { TimelineSurface } from "#/modules/Timeline/presentations/components/TimelineSurface";
import { TrackListView } from "#/modules/Track/presentations/views/TrackListView";

export const ArrangeView = (): ReactElement => {
    return (
        <div className="flex h-full">
            <TrackListView />
            <div className="flex flex-1 flex-col overflow-hidden">
                <TimelineSurface />
            </div>
        </div>
    );
};
