import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { LayoutTemplate } from 'lucide-react';
import type { Preferences } from '../../../models/Preferences';
import { SectionTitle, FieldGroup } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const LayoutSection = ({ prefs, update }: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<LayoutTemplate className="size-4" />} title="Layout" />

        <FieldGroup label="Panel Placement">
            <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
                Choose whether each side-panel docks to the left or right edge of the screen.
            </p>
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">Browser (Sidebar)</span>
                    <div className="flex gap-2">
                        <Button
                            variant={prefs.panelPlacementSidebar === 'left' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementSidebar: 'left' })}
                        >
                            Left
                        </Button>
                        <Button
                            variant={prefs.panelPlacementSidebar === 'right' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementSidebar: 'right' })}
                        >
                            Right
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">Inspector</span>
                    <div className="flex gap-2">
                        <Button
                            variant={prefs.panelPlacementInspector === 'left' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementInspector: 'left' })}
                        >
                            Left
                        </Button>
                        <Button
                            variant={prefs.panelPlacementInspector === 'right' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementInspector: 'right' })}
                        >
                            Right
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">Chat Panel</span>
                    <div className="flex gap-2">
                        <Button
                            variant={prefs.panelPlacementChat === 'left' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementChat: 'left' })}
                        >
                            Left
                        </Button>
                        <Button
                            variant={prefs.panelPlacementChat === 'right' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementChat: 'right' })}
                        >
                            Right
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground">AI Generation</span>
                    <div className="flex gap-2">
                        <Button
                            variant={prefs.panelPlacementAi === 'left' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementAi: 'left' })}
                        >
                            Left
                        </Button>
                        <Button
                            variant={prefs.panelPlacementAi === 'right' ? 'secondary' : 'outline'}
                            size="xs"
                            onClick={() => update({ panelPlacementAi: 'right' })}
                        >
                            Right
                        </Button>
                    </div>
                </div>
            </div>
        </FieldGroup>
    </>
);
