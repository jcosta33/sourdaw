import { type ReactElement, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { renameProject, saveProject } from '../../../useCases/workspaceViewActions';

type ProjectNameProps = {
    name: string;
    dirty: boolean;
};

export const ProjectName = ({ name, dirty }: ProjectNameProps): ReactElement => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name);

    const commit = () => {
        if (value.trim() && value !== name) {
            renameProject(value.trim());
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <input
                className="h-6 w-32 rounded bg-surface-overlay px-1.5 text-xs text-foreground outline-none ring-1 ring-ring"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        commit();
                    }
                    if (e.key === 'Escape') {
                        setEditing(false);
                    }
                }}
                autoFocus
            />
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-accent truncate max-w-36"
                    onClick={() => {
                        setEditing(true);
                        setValue(name);
                    }}
                    onDoubleClick={() => saveProject()}
                >
                    <span className="truncate">{name}</span>
                    {dirty && <span className="text-muted-foreground">•</span>}
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to rename, double-click to save</TooltipContent>
        </Tooltip>
    );
};
