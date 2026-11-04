import { type ReactElement } from 'react';

import { Plus } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { defaultVcaGroupState, vcaGroupStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

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
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => {
                                    const projectIdentity = captureProjectIdentity();
                                    const name = `VCA ${groups.length + 1}`;
                                    void executeUserAppAction(
                                        {
                                            type: 'createVcaGroup',
                                            payload: { name, trackIds: [track.id] },
                                        },
                                        {
                                            shouldExecute: () => captureProjectIdentity() === projectIdentity,
                                        }
                                    );
                                }}
                                aria-label="Create VCA group"
                            >
                                <Plus className="size-3" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Create new VCA group with this track</TooltipContent>
                    </Tooltip>
                }
            />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <SurfaceCard>
                    <Row gap={2}>
                        <DawCompactSelect
                            className="flex-1 border-border"
                            value={track.vcaGroupId ?? ''}
                            onChange={(event) => {
                                const projectIdentity = captureProjectIdentity();
                                const val = event.target.value;
                                if (val) {
                                    void executeUserAppAction(
                                        {
                                            type: 'assignToVca',
                                            payload: { trackId: track.id, vcaGroupId: val },
                                        },
                                        {
                                            shouldExecute: () => captureProjectIdentity() === projectIdentity,
                                        }
                                    );
                                } else {
                                    void executeUserAppAction(
                                        {
                                            type: 'removeFromVca',
                                            payload: { trackId: track.id },
                                        },
                                        {
                                            shouldExecute: () => captureProjectIdentity() === projectIdentity,
                                        }
                                    );
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
