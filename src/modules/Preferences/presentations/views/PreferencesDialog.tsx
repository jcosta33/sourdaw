import { type ReactElement, useState } from 'react';

import { KeyboardMusic, AudioLines, Keyboard, Palette, Cpu, Sparkles, Settings, LayoutTemplate } from 'lucide-react';

import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawSideRail } from '#/components/daw/DawSideRail';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Separator } from '#/components/ui/separator';
import { useStore } from '#/infra/store/useStore';
import { AudioDevicePicker, PluginScanSettings } from '#/modules/AudioEngine/presentations/views';
import { cn } from '#/utils/Styles/cn';

import { defaultPreferences, type Preferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { resetPreferences } from '../../useCases/resetPreferences';
import { updatePreferences } from '../../useCases/updatePreferences';

import { AiSection } from './preferences/AiSection';
import { AppearanceSection } from './preferences/AppearanceSection';
import { GeneralSection } from './preferences/GeneralSection';
import { LayoutSection } from './preferences/LayoutSection';
import { MidiSection } from './preferences/MidiSection';
import { PerformanceSection } from './preferences/PerformanceSection';
import { SectionTitle, FieldGroup } from './preferencesShared';
import { ShortcutsSection } from './ShortcutsSection';

// ── Types ─────────────────────────────────────────────────────────────

type PreferencesDialogProps = {
    open: boolean;
    onClose: () => void;
};

type PreferencesSection = 'general' | 'appearance' | 'layout' | 'audio' | 'midi' | 'performance' | 'ai' | 'shortcuts';

type NavItem = {
    id: PreferencesSection;
    label: string;
    icon: ReactElement;
};

const NAV_ITEMS: NavItem[] = [
    { id: 'general', label: 'General', icon: <Settings className="size-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="size-3.5" /> },
    { id: 'layout', label: 'Layout', icon: <LayoutTemplate className="size-3.5" /> },
    { id: 'audio', label: 'Audio', icon: <AudioLines className="size-3.5" /> },
    { id: 'midi', label: 'MIDI', icon: <KeyboardMusic className="size-3.5" /> },
    { id: 'performance', label: 'Performance', icon: <Cpu className="size-3.5" /> },
    { id: 'ai', label: 'AI', icon: <Sparkles className="size-3.5" /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="size-3.5" /> },
];

// ── Section props ─────────────────────────────────────────────────────

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

// ── Main dialog ───────────────────────────────────────────────────────

export const PreferencesDialog = ({ open, onClose }: PreferencesDialogProps): ReactElement => {
    const prefs = useStore<Preferences>(preferencesStore, defaultPreferences);
    const [section, setSection] = useState<PreferencesSection>('general');

    const update = (partial: Partial<Preferences>): void => {
        updatePreferences({ patch: partial });
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onClose();
                }
            }}
        >
            <DialogContent className="w-[720px] max-w-[90vw] max-h-[80vh] p-0 bg-surface-raised overflow-hidden">
                <Row align="stretch" className="h-[520px]">
                    {/* ── Sidebar navigation ── */}
                    <DawSideRail className="w-[180px] p-3">
                        <Stack as="nav" gap={0.5} className="h-full">
                            <DialogHeader className="mb-3">
                                <DialogTitle className="text-sm font-semibold">Preferences</DialogTitle>
                            </DialogHeader>
                            {NAV_ITEMS.map((item) => (
                                <Button
                                    variant="bare"
                                    size="bare"
                                    type="button"
                                    key={item.id}
                                    className={cn(
                                        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                                        section === item.id
                                            ? 'bg-primary/10 font-medium text-primary'
                                            : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                    )}
                                    onClick={() => setSection(item.id)}
                                >
                                    {item.icon}
                                    {item.label}
                                </Button>
                            ))}

                            <DawDialogFooter
                                align="start"
                                className="mt-auto flex-col items-stretch gap-1.5 border-white/6 bg-transparent px-0 py-3 shadow-none"
                            >
                                <Separator className="daw-seam h-px" />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start text-xs text-muted-foreground"
                                    onClick={() => resetPreferences()}
                                >
                                    Reset Defaults
                                </Button>
                                <Button size="sm" className="w-full text-xs" onClick={onClose}>
                                    Done
                                </Button>
                            </DawDialogFooter>
                        </Stack>
                    </DawSideRail>

                    {/* ── Content area ── */}
                    <DawDialogBody scrollable className="flex-1 gap-5 bg-surface-base/60 p-5">
                        {section === 'general' ? <GeneralSection prefs={prefs} update={update} /> : null}
                        {section === 'appearance' ? <AppearanceSection prefs={prefs} update={update} /> : null}
                        {section === 'layout' ? <LayoutSection prefs={prefs} update={update} /> : null}
                        {section === 'audio' ? <AudioSection prefs={prefs} update={update} /> : null}
                        {section === 'midi' ? <MidiSection prefs={prefs} update={update} /> : null}
                        {section === 'performance' ? <PerformanceSection prefs={prefs} update={update} /> : null}
                        {section === 'ai' ? <AiSection /> : null}
                        {section === 'shortcuts' ? <ShortcutsSection /> : null}
                    </DawDialogBody>
                </Row>
            </DialogContent>
        </Dialog>
    );
};

// ── Audio (kept inline — only 13 lines) ──────────────────────────────

const AudioSection = (_props: SectionProps): ReactElement => (
    <>
        <SectionTitle icon={<AudioLines className="size-4" />} title="Audio" />

        <FieldGroup label="Audio Devices">
            <AudioDevicePicker />
        </FieldGroup>

        <Separator />

        <PluginScanSettings />
    </>
);
