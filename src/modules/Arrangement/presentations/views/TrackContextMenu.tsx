import { type ReactElement, type MouseEvent, type ReactNode, useState, useRef } from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuInlineEditor } from '#/components/daw/DawMenuInlineEditor';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { executeAppAction } from '#/modules/Command/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { cn } from '#/utils/Styles/cn';
import { TRACK_COLOR_PRESETS } from '#/utils/UI/colorPresets';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { type Track, type InputMonitoring } from '../../models/Track';
import { addClip } from '../../useCases/clip/addClip';
import { duplicateTrack } from '../../useCases/duplicateTrack';
import { bounceTrack, type BounceOptions } from '../../useCases/freezeBounce/bounceTrack';
import { flattenTrack } from '../../useCases/freezeBounce/flattenTrack';
import { freezeTrack } from '../../useCases/freezeBounce/freezeTrack';
import { unfreezeTrack } from '../../useCases/freezeBounce/unfreezeTrack';
import { importAudioClipToTrack } from '../../useCases/importAudioClipToTrack';
import { importMidiFile } from '../../useCases/importMidiFile';
import { removeTrack } from '../../useCases/removeTrack';
import { renameTrack } from '../../useCases/renameTrack';
import { saveTrackAsTemplate } from '../../useCases/saveTrackAsTemplate';
import { setInputMonitoring } from '../../useCases/setTrackGainPan/setInputMonitoring';
import { setTrackColor } from '../../useCases/setTrackGainPan/setTrackColor';
import { toggleSoloSafe } from '../../useCases/toggleTrackState/toggleSoloSafe';

import { BounceOptionsDialog } from './BounceOptionsDialog';

const INPUT_MON_OPTIONS: { value: InputMonitoring; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
];

type TrackContextMenuProps = {
    track: Track;
    children: ReactNode;
};

type MenuPosition = { x: number; y: number } | null;

export const TrackContextMenu = ({ track, children }: TrackContextMenuProps): ReactElement => {
    const [position, setPosition] = useState<MenuPosition>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [showBounceDialog, setShowBounceDialog] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showInputMon, setShowInputMon] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const midiInputRef = useRef<HTMLInputElement>(null);

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setPosition({ x: event.clientX, y: event.clientY });
    };

    const close = () => {
        setPosition(null);
        setRenaming(false);
        setShowColorPicker(false);
        setShowInputMon(false);
    };

    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, close);

    const handleDuplicate = () => {
        duplicateTrack(track.id);
        close();
    };

    const handleRenameStart = () => {
        setRenameValue(track.name);
        setRenaming(true);
    };

    const handleRenameCommit = () => {
        if (renameValue.trim()) {
            renameTrack(track.id, renameValue.trim());
        }
        close();
    };

    const handleImportAudio = async (file: File) => {
        await importAudioClipToTrack(track.id, file);
        close();
    };

    const handleBounceConfirm = (options: BounceOptions) => {
        void bounceTrack(track.id, options);
    };

    let freezeLabel = 'Freeze';
    if (track.freezeState.status === 'stale') {
        freezeLabel = 'Update Freeze';
    } else if (track.frozen) {
        freezeLabel = 'Unfreeze';
    }

    type MenuItem = { label: string; action: () => void; destructive?: boolean };
    const actions: (MenuItem | { label: '---' })[] = [
        {
            label: 'Add Clip',
            action: () => {
                addClip({
                    trackId: track.id,
                    startBeat: 0,
                    endBeat: 16,
                    name: `Clip ${Date.now() % 1000}`,
                    type: track.kind === 'midi' ? 'midi' : 'audio',
                });
                close();
            },
        },
        { label: 'Import Audio...', action: () => fileInputRef.current?.click() },
        { label: 'Import MIDI...', action: () => midiInputRef.current?.click() },
        { label: 'Duplicate Track', action: handleDuplicate },
        { label: 'Rename', action: handleRenameStart },
        { label: 'Track Color...', action: () => setShowColorPicker(true) },
        { label: '---' },
        {
            label: track.armed ? 'Disarm' : 'Arm for Recording',
            action: () => {
                void executeAppAction({
                    type: 'armTrack',
                    payload: { trackId: track.id, armed: !track.armed },
                });
                close();
            },
        },
        {
            label: track.soloSafe ? 'Disable Solo Safe' : 'Solo Safe',
            action: () => {
                toggleSoloSafe(track.id);
                close();
            },
        },
        ...(track.kind === 'audio' || track.kind === 'midi'
            ? [
                  {
                      label: `Input Monitor: ${track.inputMonitoring.charAt(0).toUpperCase() + track.inputMonitoring.slice(1)}`,
                      action: () => setShowInputMon(true),
                  },
              ]
            : []),
        {
            label: freezeLabel,
            action: () => {
                if (track.frozen) {
                    void unfreezeTrack(track.id);
                } else {
                    void freezeTrack(track.id);
                }
                close();
            },
        },
        ...(track.frozen
            ? [
                  {
                      label: 'Flatten Track',
                      action: () => {
                          void flattenTrack(track.id);
                          close();
                      },
                  },
              ]
            : []),
        {
            label: 'Bounce...',
            action: () => {
                setShowBounceDialog(true);
                close();
            },
        },
        { label: '---' },
        {
            label: 'Save as Template',
            action: () => {
                void saveTrackAsTemplate(track.id, track.name);
                close();
            },
        },
        { label: '---' },
        {
            label: 'Delete Track',
            action: () => {
                close();
                void (async () => {
                    const ok = await confirmUser({
                        title: `Delete "${track.name}"?`,
                        message: 'This action cannot be undone.',
                        confirmLabel: 'Delete',
                        variant: 'danger',
                    });
                    if (ok) {
                        void removeTrack(track.id);
                    }
                })();
            },
            destructive: true,
        },
    ];

    let menuInnerContent;
    if (renaming) {
        menuInnerContent = (
            <DawMenuInlineEditor
                label="Rename Track"
                value={renameValue}
                onChange={setRenameValue}
                onSubmit={handleRenameCommit}
                onCancel={close}
            />
        );
    } else if (showColorPicker) {
        menuInnerContent = (
            <div className="p-2">
                <DawMenuMutedRow className="mb-1.5 px-0 py-0">Track Color</DawMenuMutedRow>
                <div className="grid grid-cols-5 gap-1">
                    {TRACK_COLOR_PRESETS.map((color) => (
                        <DawSwatchButton
                            key={color}
                            color={color}
                            active={track.color === color}
                            className={cn('size-5 transition-transform hover:scale-110')}
                            onClick={() => {
                                setTrackColor(track.id, color);
                                close();
                            }}
                            aria-label={`Set color`}
                        />
                    ))}
                </div>
            </div>
        );
    } else if (showInputMon) {
        menuInnerContent = (
            <div className="p-1">
                <DawMenuMutedRow className="mb-1 px-2 py-0">Input Monitoring</DawMenuMutedRow>
                {INPUT_MON_OPTIONS.map((opt) => (
                    <DawMenuButton
                        key={opt.value}
                        role="menuitem"
                        className={cn(track.inputMonitoring === opt.value && 'bg-accent/50')}
                        active={track.inputMonitoring === opt.value}
                        onClick={() => {
                            setInputMonitoring(track.id, opt.value);
                            close();
                        }}
                    >
                        {opt.label}
                    </DawMenuButton>
                ))}
            </div>
        );
    } else {
        menuInnerContent = actions.map((item, index) =>
            item.label === '---' ? (
                <DawMenuSeparator key={index} className="border-border/50" />
            ) : (
                <DawMenuButton
                    key={index}
                    role="menuitem"
                    tone={'destructive' in item && item.destructive ? 'danger' : 'default'}
                    onClick={(item as MenuItem).action}
                >
                    {item.label}
                </DawMenuButton>
            )
        );
    }

    let contextMenuContent = null;
    if (position) {
        contextMenuContent = (
            <DawContextMenuSurface
                ref={menuRef}
                x={position.x}
                y={position.y}
                xClampOffset={220}
                yClampOffset={300}
                backdrop
                onClose={close}
                className="min-w-[200px] animate-in fade-in zoom-in-95"
                role="menu"
            >
                {menuInnerContent}
            </DawContextMenuSurface>
        );
    }

    return (
        <div onContextMenu={handleContextMenu}>
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        void handleImportAudio(file);
                    }
                    event.target.value = '';
                }}
            />
            <input
                ref={midiInputRef}
                type="file"
                accept=".mid,.midi"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        void importMidiFile(file);
                    }
                    event.target.value = '';
                    close();
                }}
            />
            {children}
            <BounceOptionsDialog
                track={track}
                open={showBounceDialog}
                onOpenChange={setShowBounceDialog}
                onConfirm={handleBounceConfirm}
            />
            {contextMenuContent}
        </div>
    );
};
