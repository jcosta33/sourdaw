import { type ChangeEvent, type ReactElement, type RefObject, useLayoutEffect, useRef, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { hardwareControllerStore } from '../../stores/hardwareControllerStore';
import { downloadHardwareMappings } from '../../useCases/hardware/downloadHardwareMappings';
import { importHardwareMappingsFile } from '../../useCases/hardware/importHardwareMappingsFile';

import type { ControllerProfile } from '../../models/ControllerProfile';

const EMPTY_STATE = { connectedDevices: [], profiles: [] };
const IMPORT_FEEDBACK: Record<'imported' | 'rejected', { error: boolean; message: string }> = {
    imported: { error: false, message: 'Mappings imported.' },
    rejected: { error: true, message: 'Mapping file was not imported. Existing mappings were kept.' },
};

const HardwareMappingContent = ({ profile }: { profile: ControllerProfile | undefined }): ReactElement => {
    if (!profile) {
        return <p className="text-xs text-muted-foreground">No hardware profiles are available.</p>;
    }
    if (profile.mappings.length === 0) {
        return <p className="text-xs text-muted-foreground">This profile has no mappings.</p>;
    }
    return (
        <div className="max-h-48 overflow-auto">
            <table className="w-full text-left text-xs">
                <caption className="sr-only">{profile.name} mappings</caption>
                <thead>
                    <tr>
                        <th scope="col">Control</th>
                        <th scope="col">Channel</th>
                        <th scope="col">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {profile.mappings.map((mapping) => (
                        <tr key={mapping.id}>
                            <td>
                                {mapping.controlType} {mapping.controlIndex}
                            </td>
                            <td>{mapping.channel}</td>
                            <td>
                                {mapping.action.type}
                                {mapping.action.target ? `: ${mapping.action.target}` : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const HardwareMappingActions = ({
    disabled,
    input,
    onExport,
    onImport,
    onFileChange,
}: {
    disabled: boolean;
    input: RefObject<HTMLInputElement | null>;
    onExport: () => void;
    onImport: () => void;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): ReactElement => (
    <Row gap={2}>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onExport}>
            Export mappings
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onImport}>
            Import mappings
        </Button>
        <input
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label="Mapping JSON file"
            className="sr-only"
            tabIndex={-1}
            disabled={disabled}
            onChange={onFileChange}
        />
    </Row>
);

const HardwareMappingPending = ({ pending }: { pending: boolean }): ReactElement | null =>
    pending ? (
        <p role="status" className="text-xs text-muted-foreground">
            Reading mapping file…
        </p>
    ) : null;

const HardwareMappingFeedback = ({
    feedback,
}: {
    feedback: { error: boolean; message: string } | null;
}): ReactElement | null =>
    feedback ? (
        <p role={feedback.error ? 'alert' : 'status'} className="text-xs text-muted-foreground">
            {feedback.message}
        </p>
    ) : null;

export const HardwareMappingManager = (): ReactElement => {
    const state = useStore(hardwareControllerStore, EMPTY_STATE);
    const [selectedId, setSelectedId] = useState('');
    const profile = state.profiles.find((candidate) => candidate.id === selectedId) ?? state.profiles[0];
    const profileId = profile?.id;
    const selectedProfileId = useRef(profileId);
    const importSequence = useRef(0);
    const mounted = useRef(true);
    const input = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState(false);
    const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);

    useLayoutEffect(() => {
        if (selectedProfileId.current !== profileId) {
            selectedProfileId.current = profileId;
            importSequence.current += 1;
            setPending(false);
            setFeedback(null);
        }
    }, [profileId]);

    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            importSequence.current += 1;
        };
    }, []);

    const selectProfile = (event: ChangeEvent<HTMLSelectElement>): void => {
        importSequence.current += 1;
        selectedProfileId.current = event.target.value;
        setSelectedId(event.target.value);
        setPending(false);
        setFeedback(null);
    };

    const importFile = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !profile) {
            return;
        }
        const sequence = ++importSequence.current;
        const targetId = profile.id;
        const isCurrent = (): boolean =>
            mounted.current && sequence === importSequence.current && selectedProfileId.current === targetId;
        setPending(true);
        setFeedback(null);
        void importHardwareMappingsFile(targetId, file, isCurrent).then((result) => {
            if (!isCurrent()) {
                return;
            }
            setPending(false);
            if (result === 'cancelled') {
                return;
            }
            setFeedback(IMPORT_FEEDBACK[result]);
        });
    };

    const exportFile = (): void => {
        if (!profile) {
            return;
        }
        const downloaded = downloadHardwareMappings(profile.id);
        if (downloaded) {
            setFeedback({ error: false, message: 'Mapping download started.' });
        } else {
            setFeedback({ error: true, message: 'Mapping file could not be exported.' });
        }
    };

    return (
        <section aria-label="Hardware mappings" className="space-y-2">
            <h3 className="text-xs font-medium text-foreground">Hardware mappings</h3>
            <p className="text-xs text-muted-foreground">Inspect and transfer this session's profile mappings.</p>
            <DawCompactSelect
                aria-label="Hardware profile"
                value={profileId ?? ''}
                onChange={selectProfile}
                disabled={state.profiles.length === 0}
            >
                {state.profiles.length === 0 ? <option value="">No profiles</option> : null}
                {state.profiles.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                    </option>
                ))}
            </DawCompactSelect>
            <HardwareMappingContent profile={profile} />
            <HardwareMappingActions
                disabled={!profile}
                input={input}
                onExport={exportFile}
                onImport={() => input.current?.click()}
                onFileChange={importFile}
            />
            <HardwareMappingPending pending={pending} />
            <HardwareMappingFeedback feedback={feedback} />
        </section>
    );
};
