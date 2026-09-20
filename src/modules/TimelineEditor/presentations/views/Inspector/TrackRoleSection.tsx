import { type ReactElement, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { useStore } from '#/infra/store/useStore';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { getCanonicalTrackRole, getCanonicalTrackRoleOptions, setTrackCanonicalRole } from '#/modules/Project/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

const SOURCE_LABELS = {
    authored: 'Production brief',
    'name-tags': 'Track name or kind',
    'clip-content': 'Stored clip content',
    unknown: 'No role evidence',
};

export const TrackRoleSection = ({ track }: { track: Track }): ReactElement => {
    const project = useStore(projectStore, defaultProjectStoreState);
    const midi = useStore(midiStore, defaultMidiStoreState);
    const [pending, setPending] = useState(false);
    const [errorMessage, setError] = useState<string | null>(null);
    const role = getCanonicalTrackRole({
        track,
        trackRoles: project.productionBrief.trackRoles,
        notesByClipId: midi.notesByClipId,
    });
    const authored = role.source === 'authored';
    let value = '';
    if (authored) {
        value = role.evidence === 'authored-role' ? role.role : 'legacy';
    }

    const changeRole = async (next: string): Promise<void> => {
        setPending(true);
        setError(null);
        try {
            await setTrackCanonicalRole({
                trackId: track.id,
                role: next || null,
                expectedRevision: project.productionBrief.revision,
            });
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not update the track role.');
        } finally {
            setPending(false);
        }
    };

    return (
        <div>
            <DawHeaderBand compact title="Track Role" />
            <SurfaceCard>
                <DawCompactSelect
                    aria-label="Track role"
                    value={value}
                    disabled={pending}
                    onChange={(event) => void changeRole(event.target.value)}
                >
                    <option value="">Automatic</option>
                    {value === 'legacy' ? (
                        <option value="legacy" disabled>
                            Saved role needs review
                        </option>
                    ) : null}
                    {getCanonicalTrackRoleOptions().map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </DawCompactSelect>
                <p className="mt-1 text-[10px] text-muted-foreground">
                    {role.role} · {SOURCE_LABELS[role.source]}
                </p>
                {errorMessage ? (
                    <p role="alert" className="text-[10px] text-destructive">
                        {errorMessage}
                    </p>
                ) : null}
            </SurfaceCard>
        </div>
    );
};
