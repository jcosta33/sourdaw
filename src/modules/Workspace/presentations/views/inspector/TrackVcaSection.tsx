import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Plus } from 'lucide-react';
import { assignToVca, removeFromVca, getVcaGroups, createVcaGroup } from '#/modules/Arrangement/useCases/vcaUseCases';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

type TrackVcaSectionProps = {
    track: Track;
};

export const TrackVcaSection = ({ track }: TrackVcaSectionProps): ReactElement => {
    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1 flex flex-row items-center justify-between">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">VCA Group</div>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                        const name = `VCA ${getVcaGroups().length + 1}`;
                        createVcaGroup(name, [track.id]);
                    }}
                    aria-label="Create VCA group"
                    title="Create new VCA group with this track"
                >
                    <Plus className="size-3" />
                </Button>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                    <div className="flex items-center gap-2">
                        <select
                            className="flex-1 rounded-sm border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={track.vcaGroupId ?? ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val) {
                                    assignToVca(track.id, val);
                                } else {
                                    removeFromVca(track.id);
                                }
                            }}
                            aria-label="VCA group"
                        >
                            <option value="">None</option>
                            {getVcaGroups().map((g) => (
                                <option key={g.id} value={g.id}>
                                    {g.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </Card>
            </div>
        </div>
    );
};
