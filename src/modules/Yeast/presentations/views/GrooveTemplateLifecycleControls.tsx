import { type FormEvent, type ReactElement, useState } from 'react';

import { deleteYeastGrooveTemplate } from '../../useCases/deleteYeastGrooveTemplate';
import { renameYeastGrooveTemplate } from '../../useCases/renameYeastGrooveTemplate';

type Props = {
    templateId: string;
    templateName: string;
};

export const GrooveTemplateLifecycleControls = ({ templateId, templateName }: Props): ReactElement => {
    const [error, setError] = useState<string | null>(null);

    const handleRename = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const nameInput = event.currentTarget.elements.namedItem('groove-template-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        setError(null);
        renameYeastGrooveTemplate(templateId, nameInput.value).catch(() => {
            setError('The groove template could not be renamed.');
        });
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
                <label className="sr-only" htmlFor={`groove-template-name-${templateId}`}>
                    Groove template name
                </label>
                <input
                    key={templateId}
                    id={`groove-template-name-${templateId}`}
                    name="groove-template-name"
                    defaultValue={templateName}
                />
                <button type="submit">Rename</button>
            </form>
            <button type="button" onClick={handleDelete}>
                Delete template
            </button>
            {error ? <p role="alert">{error}</p> : null}
        </div>
    );
};
