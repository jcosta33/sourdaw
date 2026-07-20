import { type ChangeEvent, type FormEvent, type ReactElement, useId, useState } from 'react';

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
};

export const GrooveTemplateLifecycleControls = ({ templateId, templateName }: Props): ReactElement => {
    const nameInputId = useId();
    const [error, setError] = useState<string | null>(null);
    const [renameState, setRenameState] = useState<RenameState>({
        templateId,
        canonicalName: templateName,
        draftName: templateName,
        pending: false,
        submittedName: null,
    });

    if (renameState.templateId !== templateId) {
        setRenameState({
            templateId,
            canonicalName: templateName,
            draftName: templateName,
            pending: false,
            submittedName: null,
        });
    } else if (renameState.canonicalName !== templateName) {
        if (renameState.pending) {
            setRenameState({ ...renameState, canonicalName: templateName });
        } else if (renameState.submittedName === templateName) {
            setRenameState({ ...renameState, canonicalName: templateName, submittedName: null });
        } else {
            setRenameState({
                ...renameState,
                canonicalName: templateName,
                draftName: templateName,
                submittedName: null,
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
        }));
        renameYeastGrooveTemplate(templateId, requestedName)
            .then(() => {
                setRenameState((current) => {
                    if (current.templateId !== templateId || current.submittedName !== requestedName) {
                        return current;
                    }
                    return {
                        ...current,
                        pending: false,
                        submittedName: current.canonicalName === requestedName ? null : current.submittedName,
                    };
                });
                return undefined;
            })
            .catch(() => {
                setRenameState((current) => {
                    if (current.templateId !== templateId || current.submittedName !== requestedName) {
                        return current;
                    }
                    return { ...current, pending: false, submittedName: null };
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
        <div className="flex flex-col gap-1 px-1 pb-1">
            <form className="flex gap-1" onSubmit={handleRename}>
                <label className="sr-only" htmlFor={nameInputId}>
                    Groove template name
                </label>
                <input
                    id={nameInputId}
                    name="groove-template-name"
                    value={renameState.draftName}
                    onChange={handleDraftChange}
                />
                <button type="submit" disabled={renameState.pending}>
                    {renameState.pending ? 'Renaming…' : 'Rename'}
                </button>
            </form>
            <button type="button" disabled={renameState.pending} onClick={handleDelete}>
                Delete template
            </button>
            {error ? <p role="alert">{error}</p> : null}
        </div>
    );
};
