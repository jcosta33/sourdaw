import { type ReactElement } from 'react';

import { LayoutTemplate } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { SectionTitle, FieldGroup } from '../preferencesShared';

import type { Preferences } from '../../../models/Preferences';

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
            <Stack gap={4}>
                <Row justify="between">
                    <span className="text-xs text-foreground">Browser (Sidebar)</span>
                    <Row align="stretch" gap={2}>
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
                    </Row>
                </Row>

                <Row justify="between">
                    <span className="text-xs text-foreground">Inspector</span>
                    <Row align="stretch" gap={2}>
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
                    </Row>
                </Row>

                <Row justify="between">
                    <span className="text-xs text-foreground">Chat Panel</span>
                    <Row align="stretch" gap={2}>
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
                    </Row>
                </Row>

                <Row justify="between">
                    <span className="text-xs text-foreground">AI Generation</span>
                    <Row align="stretch" gap={2}>
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
                    </Row>
                </Row>
            </Stack>
        </FieldGroup>
    </>
);
