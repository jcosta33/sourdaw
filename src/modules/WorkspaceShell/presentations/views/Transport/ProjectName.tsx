import { type ReactElement, useState } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
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
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    data-testid="project-name"
                    className="transport-bar__project-name daw-readout-well group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-l-sm rounded-r-none border-r-0 px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/[0.04] hover:brightness-[1.06] hover:text-foreground"
                    onClick={() => {
                        setEditing(true);
                        setValue(name);
                    }}
                    onDoubleClick={() => saveProject()}
                >
                    <span className="max-w-32 truncate">{name}</span>
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
                </Button>
            </TooltipTrigger>
            <TooltipContent>Click to rename, double-click to save</TooltipContent>
        </Tooltip>
    );
};
