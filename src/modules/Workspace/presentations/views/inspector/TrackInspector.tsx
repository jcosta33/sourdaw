import { type ReactElement } from 'react';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';
import { TrackHeaderSection } from './TrackHeaderSection';
import { TrackAlternativesSection } from './TrackAlternativesSection';
import { TrackLevelSection } from './TrackLevelSection';
import { TrackDevicesSection } from './TrackDevicesSection';
import { TrackAutomationSection } from './TrackAutomationSection';
import { SendsEditor } from './SendsEditor';
import { TrackVcaSection } from './TrackVcaSection';
import { TrackMidiOutputSection } from './TrackMidiOutputSection';
import { TrackRoutingSection } from './TrackRoutingSection';
import { TrackClipsSection } from './TrackClipsSection';
import { TakesSection } from './TakesSection';
import { SignalFlowSection } from './SignalFlowSection';
import { MasterVisualizationsSection } from './MasterVisualizationsSection';

type TrackInspectorProps = {
    track: Track;
    allTracks: Track[];
    onSelectClip: (id: string) => void;
    onSelectDevice: (id: string) => void;
};

export const TrackInspector = ({
    track,
    allTracks,
    onSelectClip,
    onSelectDevice,
}: TrackInspectorProps): ReactElement => {
    return (
        <div className="space-y-4 p-3">
            <TrackHeaderSection track={track} />
            <TrackAlternativesSection track={track} />
            <TrackLevelSection track={track} />
            <TrackDevicesSection track={track} onSelectDevice={onSelectDevice} />
            <TrackAutomationSection track={track} />
            <SendsEditor track={track} />
            <TrackVcaSection track={track} />
            {track.kind === 'midi' ? <TrackMidiOutputSection track={track} allTracks={allTracks} /> : null}
            <TrackRoutingSection track={track} />
            <TrackClipsSection track={track} onSelectClip={onSelectClip} />
            <TakesSection trackId={track.id} />
            {track.kind === 'master' ? <MasterVisualizationsSection /> : null}
            <SignalFlowSection />
        </div>
    );
};
