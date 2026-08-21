import { type ReactElement, useState } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Row } from '#/components/layout';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { renameProject, saveProject } from '#/modules/Project/useCases';

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
            <Row gap={1.5} shrink={false}>
                <DawCompactInput
                    className="daw-readout-well w-32 px-1.5 font-medium ring-1 ring-ring"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            commit();
                        }
                        if (event.key === 'Escape') {
                            setEditing(false);
                        }
                    }}
                    autoFocus
                />
            </Row>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    data-testid="project-name"
                    className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-white/[0.04] transition-colors cursor-pointer group shrink-0"
                    onClick={() => {
                        setEditing(true);
                        setValue(name);
                    }}
                    onDoubleClick={() => saveProject()}
                >
                    {/* Project name in a subtle recessed badge */}
                    <Row gap={1} className="daw-readout-well rounded-sm px-2 py-0.5">
                        <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground truncate max-w-32 transition-colors">
                            {name}
                        </span>
                        {dirty ? (
                            <DawStatusDot
                                tone="peach"
                                pulse
                                style={{
                                    boxShadow: '0 0 4px rgba(240,160,96,0.4)',
                                    animationDuration: '2s',
                                }}
                                title="Unsaved changes"
                            />
                        ) : null}
                    </Row>
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to rename, double-click to save</TooltipContent>
        </Tooltip>
    );
};
