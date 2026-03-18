import { type ReactElement } from 'react';
import { Separator } from '#/components/ui/separator';
import { type Track } from '../../../useCases/workspaceViewActions';
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

export type TrackInspectorProps = {
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
            <Separator />
            <TrackAlternativesSection track={track} />
            <Separator />
            <TrackLevelSection track={track} />
            <Separator />
            <TrackDevicesSection track={track} onSelectDevice={onSelectDevice} />
            <Separator />
            <TrackAutomationSection track={track} />
            <Separator />
            <SendsEditor track={track} />
            <Separator />
            <TrackVcaSection track={track} />
            <Separator />
            {track.kind === 'midi' && (
                <>
                    <TrackMidiOutputSection track={track} allTracks={allTracks} />
                    <Separator />
                </>
            )}
            <TrackRoutingSection track={track} />
            <Separator />
            <TrackClipsSection track={track} onSelectClip={onSelectClip} />
            <TakesSection trackId={track.id} />
            <Separator />
            <SignalFlowSection />
        </div>
    );
};
