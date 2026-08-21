import { type ChangeEvent, type FormEvent, type ReactElement, useId, useState } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';

import { deleteYeastGrooveTemplate } from '../../useCases/deleteYeastGrooveTemplate';
import { renameYeastGrooveTemplate } from '../../useCases/renameYeastGrooveTemplate';

type Props = {
    templateId: string;
    templateName: string;
};

type RenameState = {
    templateId: string;
    canonicalName: string;
    draftName: string;
    pending: boolean;
    submittedName: string | null;
    submittedCanonicalName: string | null;
};

type ReconcileDraftNameInput = Pick<RenameState, 'draftName' | 'submittedName'> & {
    nextCanonicalName: string;
};

function reconcileDraftName({ draftName, submittedName, nextCanonicalName }: ReconcileDraftNameInput): string {
    if (submittedName !== null && draftName !== submittedName) {
        return draftName;
    }
    return nextCanonicalName;
}

export const GrooveTemplateLifecycleControls = ({ templateId, templateName }: Props): ReactElement => {
    const nameInputId = useId();
    const [error, setError] = useState<string | null>(null);
    const [renameState, setRenameState] = useState<RenameState>({
        templateId,
        canonicalName: templateName,
        draftName: templateName,
        pending: false,
        submittedName: null,
        submittedCanonicalName: null,
    });

    if (renameState.templateId !== templateId) {
        setRenameState({
            templateId,
            canonicalName: templateName,
            draftName: templateName,
            pending: false,
            submittedName: null,
            submittedCanonicalName: null,
        });
    } else if (renameState.canonicalName !== templateName) {
        const draftName = reconcileDraftName({
            draftName: renameState.draftName,
            submittedName: renameState.submittedName,
            nextCanonicalName: templateName,
        });
        if (renameState.pending) {
            setRenameState({ ...renameState, canonicalName: templateName, draftName });
        } else if (renameState.submittedName !== null) {
            setRenameState({
                ...renameState,
                canonicalName: templateName,
                draftName,
                submittedName: null,
                submittedCanonicalName: null,
            });
        } else {
            setRenameState({
                ...renameState,
                canonicalName: templateName,
                draftName: templateName,
                submittedName: null,
                submittedCanonicalName: null,
            });
        }
    }

    const handleRename = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (renameState.pending) {
            return;
        }
        const requestedName = renameState.draftName;
        setError(null);
        setRenameState((current) => ({
            ...current,
            pending: true,
            submittedName: requestedName,
            submittedCanonicalName: current.canonicalName,
        }));
        renameYeastGrooveTemplate(templateId, requestedName)
            .then(() => {
                setRenameState((current) => {
                    if (current.templateId !== templateId || current.submittedName !== requestedName) {
                        return current;
                    }
                    if (current.canonicalName !== current.submittedCanonicalName) {
                        return {
                            ...current,
                            pending: false,
                            submittedName: null,
                            submittedCanonicalName: null,
                        };
                    }
                    return {
                        ...current,
                        pending: false,
                    };
                });
                return undefined;
            })
            .catch(() => {
                setRenameState((current) => {
                    if (current.templateId !== templateId || current.submittedName !== requestedName) {
                        return current;
                    }
                    return {
                        ...current,
                        pending: false,
                        submittedName: null,
                        submittedCanonicalName: null,
                    };
                });
                setError('The groove template could not be renamed.');
            });
    };

    const handleDraftChange = (event: ChangeEvent<HTMLInputElement>): void => {
        setRenameState((current) => ({ ...current, draftName: event.target.value }));
    };

    const handleDelete = (): void => {
        setError(null);
        deleteYeastGrooveTemplate(templateId).catch(() => {
            setError('The groove template could not be deleted.');
        });
    };

    return (
        <Stack gap={1} className="px-1 pb-1">
            <Row as="form" align="stretch" gap={1} onSubmit={handleRename}>
                <label className="sr-only" htmlFor={nameInputId}>
                    Groove template name
                </label>
                <Input
                    id={nameInputId}
                    name="groove-template-name"
                    value={renameState.draftName}
                    onChange={handleDraftChange}
                />
                <Button variant="bare" size="bare" type="submit" disabled={renameState.pending}>
                    {renameState.pending ? 'Renaming…' : 'Rename'}
                </Button>
            </Row>
            <Button variant="bare" size="bare" type="button" disabled={renameState.pending} onClick={handleDelete}>
                Delete template
            </Button>
            {error ? <p role="alert">{error}</p> : null}
        </Stack>
    );
};
