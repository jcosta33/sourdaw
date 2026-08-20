import { type ReactElement } from 'react';

import { Plus } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { defaultVcaGroupState, vcaGroupStore } from '#/modules/Arrangement/stores';
import { assignToVca, removeFromVca, createVcaGroup } from '#/modules/Arrangement/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackVcaSectionProps = {
    track: Track;
};

export const TrackVcaSection = ({ track }: TrackVcaSectionProps): ReactElement => {
    // §202.1 — subscribe reactively so VCA creation/rename shows up
    // immediately in the dropdown options.
    const vcaState = useStore(vcaGroupStore, defaultVcaGroupState);
    const groups = vcaState.groups;

    return (
        <div>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="VCA Group"
                actions={
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                            const name = `VCA ${groups.length + 1}`;
                            createVcaGroup(name, [track.id]);
                        }}
                        aria-label="Create VCA group"
                        title="Create new VCA group with this track"
                    >
                        <Plus className="size-3" />
                    </Button>
                }
            />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <SurfaceCard>
                    <Row gap={2}>
                        <DawCompactSelect
                            className="flex-1 border-border"
                            value={track.vcaGroupId ?? ''}
                            onChange={(event) => {
                                const val = event.target.value;
                                if (val) {
                                    assignToVca(track.id, val);
                                } else {
                                    removeFromVca(track.id);
                                }
                            }}
                            aria-label="VCA group"
                        >
                            <option value="">None</option>
                            {groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                    {g.name}
                                </option>
                            ))}
                        </DawCompactSelect>
                    </Row>
                </SurfaceCard>
            </div>
        </div>
    );
};
