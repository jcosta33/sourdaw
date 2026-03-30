import { type ReactElement, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { renameProject, saveProject } from '#/modules/Project/useCases/projectPersistence';

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
            <div className="flex items-center gap-1.5 shrink-0">
                <input
                    className="h-6 w-32 rounded-sm px-1.5 text-xs text-foreground outline-none ring-1 ring-ring font-medium"
                    style={{
                        background: 'linear-gradient(180deg, #080808 0%, #0d0d0d 100%)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.7)',
                    }}
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
            </div>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-white/[0.04] transition-colors cursor-pointer group shrink-0"
                    onClick={() => {
                        setEditing(true);
                        setValue(name);
                    }}
                    onDoubleClick={() => saveProject()}
                >
                    {/* Project name in a subtle recessed badge */}
                    <div
                        className="flex items-center gap-1 rounded-sm px-2 py-0.5"
                        style={{
                            background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                            border: '1px solid rgba(0,0,0,0.5)',
                            borderBottom: '1px solid rgba(40,40,40,0.3)',
                        }}
                    >
                        <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground truncate max-w-32 transition-colors">
                            {name}
                        </span>
                        {dirty ? (
                            <span
                                className="size-1.5 rounded-full shrink-0 animate-pulse"
                                style={{
                                    background: 'var(--color-accent-peach, #f0a060)',
                                    boxShadow: '0 0 4px rgba(240,160,96,0.4)',
                                    animationDuration: '2s',
                                }}
                                title="Unsaved changes"
                            />
                        ) : null}
                    </div>
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to rename, double-click to save</TooltipContent>
        </Tooltip>
    );
};
