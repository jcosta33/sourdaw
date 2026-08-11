import { type ReactElement } from 'react';

import { FileUp } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { projectStore } from '#/modules/Project/stores';
import { importSclFile } from '#/modules/Project/useCases';

import { ChoiceCard } from '../../components/ChoiceCard';
import { SectionHeader } from '../../components/ProjectSectionHeader';

export const ProjectTab = (): ReactElement => {
    const project = useStore(projectStore);

    if (!project) {
        return <div />;
    }

    const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    return (
        <div className="flex flex-col gap-4 p-3">
            <div>
                <SectionHeader title="Project Meta" />
                <div className="mt-2 space-y-1 px-1">
                    <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Name</span>
                        <span className="font-medium">{project.name}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Created</span>
                        <span className="font-medium">{new Date(project.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <div>
                <SectionHeader title="Tuning & Scale" />
                <div className="mt-2 space-y-3">
                    <ChoiceCard className="flex flex-col gap-2 p-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-orange)]">
                                Global Tuning
                            </span>
                            <span className="text-[10px] text-muted-foreground">{project.tuning.name}</span>
                        </div>

                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Change the project's base tuning. Affects all built-in instruments.
                        </p>

                        <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 w-full gap-1.5 text-[10px]"
                            onClick={() => importSclFile()}
                        >
                            <FileUp className="size-3" />
                            Import Scala (.scl)
                        </Button>
                    </ChoiceCard>

                    <div className="rounded-sm border border-border/40 bg-surface-base/40 p-2">
                        <h4 className="mb-1 text-[9px] font-semibold uppercase text-muted-foreground">Active Scale</h4>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-bold">{keyNames[project.keyRoot % 12]}</span>
                            <span className="text-xs text-muted-foreground">{project.scaleName}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
