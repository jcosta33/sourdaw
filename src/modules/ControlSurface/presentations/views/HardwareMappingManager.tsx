import { type ChangeEvent, type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';

import { hardwareControllerStore } from '../../stores/hardwareControllerStore';
import { downloadHardwareMappings } from '../../useCases/hardware/downloadHardwareMappings';
import { importHardwareMappingsFile } from '../../useCases/hardware/importHardwareMappingsFile';

const EMPTY_STATE = { connectedDevices: [], profiles: [] };

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
            setFeedback(
                result === 'imported'
                    ? { error: false, message: 'Mappings imported.' }
                    : { error: true, message: 'Mapping file was not imported. Existing mappings were kept.' }
            );
        });
    };

    const exportFile = (): void => {
        if (!profile) {
            return;
        }
        const downloaded = downloadHardwareMappings(profile.id);
        setFeedback(
            downloaded
                ? { error: false, message: 'Mapping download started.' }
                : { error: true, message: 'Mapping file could not be exported.' }
        );
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
            {profile ? (
                profile.mappings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">This profile has no mappings.</p>
                ) : (
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
                )
            ) : (
                <p className="text-xs text-muted-foreground">No hardware profiles are available.</p>
            )}
            <Row gap={2}>
                <Button type="button" variant="outline" size="sm" disabled={!profile} onClick={exportFile}>
                    Export mappings
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!profile}
                    onClick={() => input.current?.click()}
                >
                    Import mappings
                </Button>
                <input
                    ref={input}
                    type="file"
                    accept=".json,application/json"
                    aria-label="Mapping JSON file"
                    className="sr-only"
                    tabIndex={-1}
                    disabled={!profile}
                    onChange={importFile}
                />
            </Row>
            {pending ? (
                <p role="status" className="text-xs text-muted-foreground">
                    Reading mapping file…
                </p>
            ) : null}
            {feedback ? (
                <p role={feedback.error ? 'alert' : 'status'} className="text-xs text-muted-foreground">
                    {feedback.message}
                </p>
            ) : null}
        </section>
    );
};
