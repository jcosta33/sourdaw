import { type ReactElement } from 'react';

import { Stack } from '#/components/layout';

import { type Track } from '../../../models/TrackViewTypes';

import { MasterVisualizationsSection } from './MasterVisualizationsSection';
import { SendsEditor } from './SendsEditor';
import { SignalFlowSection } from './SignalFlowSection';
import { TakesSection } from './TakesSection';
import { TrackAlternativesSection } from './TrackAlternativesSection';
import { TrackAutomationSection } from './TrackAutomationSection';
import { TrackClipsSection } from './TrackClipsSection';
import { TrackDevicesSection } from './TrackDevicesSection';
import { TrackHeaderSection } from './TrackHeaderSection';
import { TrackLatencySection } from './TrackLatencySection';
import { TrackLevelSection } from './TrackLevelSection';
import { TrackMidiFxSection } from './TrackMidiFxSection';
import { TrackMidiOutputSection } from './TrackMidiOutputSection';
import { TrackNotesSection } from './TrackNotesSection';
import { TrackRoutingSection } from './TrackRoutingSection';
import { TrackVcaSection } from './TrackVcaSection';

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
        <Stack gap={4} className="p-3">
            <TrackHeaderSection track={track} />
            <TrackAlternativesSection track={track} />
            <TrackLevelSection track={track} />
            <TrackMidiFxSection track={track} />
            <TrackDevicesSection track={track} onSelectDevice={onSelectDevice} />
            <TrackAutomationSection track={track} />
            <SendsEditor track={track} />
            <TrackVcaSection track={track} />
            {track.kind === 'midi' ? <TrackMidiOutputSection track={track} allTracks={allTracks} /> : null}
            <TrackRoutingSection track={track} />
            <TrackLatencySection trackId={track.id} />
            <TrackClipsSection track={track} onSelectClip={onSelectClip} />
            <TakesSection trackId={track.id} />
            {track.kind === 'master' ? <MasterVisualizationsSection /> : null}
            <SignalFlowSection />
            <TrackNotesSection track={track} />
        </Stack>
    );
};
