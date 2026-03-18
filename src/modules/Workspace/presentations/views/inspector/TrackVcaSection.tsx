import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { Plus } from 'lucide-react';
import { assignToVca, removeFromVca, getVcaGroups, createVcaGroup } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackVcaSectionProps = {
    track: Track;
};

export const TrackVcaSection = ({ track }: TrackVcaSectionProps): ReactElement => {
    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">VCA Group</h3>
            <div className="flex items-center gap-2">
                <select
                    className="flex-1 rounded border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
        </section>
    );
};
