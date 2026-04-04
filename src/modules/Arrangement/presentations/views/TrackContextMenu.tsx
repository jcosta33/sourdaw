import { type ReactElement,
    type MouseEvent, type ReactNode, useState, useRef } from 'react';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuButton, DawMenuMutedRow, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawSwatchButton } from '#/components/daw/DawSwatchButton';
import { cn } from '#/helpers/Styles/cn';
import { removeTrack } from '../../useCases/removeTrack';
import { toggleSoloSafe } from '../../useCases/toggleTrackState/toggleSoloSafe';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { renameTrack } from '../../useCases/renameTrack';
import { freezeTrack, unfreezeTrack, bounceInPlace, bounceToNewTrack } from '../../useCases/freezeBounce';
import { armTrack } from '../../useCases/recording';
import { addTrack } from '../../useCases/addTrack';
import { saveTrackAsTemplate } from '../../useCases/trackTemplate';
import { setTrackColor, setInputMonitoring } from '../../useCases/setTrackGainPan';
import { decodeAudioFile } from '../../useCases/trackViewActions';
import { importMidiFile } from '#/modules/MIDI/useCases/importMidiFile';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type Track, type InputMonitoring } from '../../models/Track';
import { TRACK_COLOR_PRESETS } from '#/helpers/UI/colorPresets';
import { useContextMenuDismiss } from '#/helpers/UI/useContextMenuDismiss';



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

    const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        setPosition({ x: e.clientX, y: e.clientY });
    };

    const close = () => {
        setPosition(null);
        setRenaming(false);
    };

    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, close);

    const handleDuplicate = () => {
        const newTrack = addTrack({ name: `${track.name} (copy)`, kind: track.kind });
        if (newTrack) {
            for (const clip of track.clips) {
                addClip({
                    trackId: newTrack.id,
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                    name: clip.name,
                    type: clip.type,
                    audioBufferId: clip.audioBufferId,
                });
            }
        }
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

    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showInputMon, setShowInputMon] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const midiInputRef = useRef<HTMLInputElement>(null);

    const handleImportAudio = async (file: File) => {
        try {
            const { id: bufferId, buffer } = await decodeAudioFile(file);
            const tempo = 120;
            const durationBeats = Math.ceil((buffer.duration / 60) * tempo);
            const lastClipEnd = Math.max(0, ...track.clips.map((c) => c.endBeat));
            addClip({
                trackId: track.id,
                startBeat: lastClipEnd,
                endBeat: lastClipEnd + durationBeats,
                name: file.name.replace(/\.[^.]+$/, ''),
                type: 'audio',
                audioBufferId: bufferId,
            });
        } catch {
            notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
        }
        close();
    };

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
                armTrack(track.id, !track.armed);
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
            label: track.frozen ? 'Unfreeze' : 'Freeze',
            action: () => {
                if (track.frozen) {
                    unfreezeTrack(track.id);
                } else {
                    freezeTrack(track.id);
                }
                close();
            },
        },
        {
            label: 'Bounce in Place',
            action: () => {
                bounceInPlace(track.id);
                close();
            },
        },
        {
            label: 'Bounce to New Track',
            action: () => {
                bounceToNewTrack(track.id);
                close();
            },
        },
        { label: '---' },
        {
            label: 'Save as Template',
            action: () => {
                saveTrackAsTemplate(track.id, track.name);
                close();
            },
        },
        { label: '---' },
        {
            label: 'Delete Track',
            action: () => {
                if (window.confirm('Are you sure you want to delete this track? This action cannot be undone.')) {
                    removeTrack(track.id);
                }
                close();
            },
            destructive: true,
        },
    ];

    return (
        <div onContextMenu={handleContextMenu}>
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                        void handleImportAudio(file);
                    }
                    e.target.value = '';
                }}
            />
            <input
                ref={midiInputRef}
                type="file"
                accept=".mid,.midi"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                        void importMidiFile(file);
                    }
                    e.target.value = '';
                    close();
                }}
            />
            {children}

            {position ? (
                <>
                    <div className="fixed inset-0 z-40" onClick={close} />
                    <div
                        ref={menuRef}
                        className="daw-floating-surface fixed z-50 min-w-[200px] rounded-md py-1 animate-in fade-in zoom-in-95"
                        style={{
                            left: Math.min(position.x, window.innerWidth - 220),
                            top: Math.min(position.y, window.innerHeight - 300),
                        }}
                        role="menu"
                    >
                        {renaming ? (
                            <div className="px-2 py-1">
                                <DawCompactInput
                                    size="micro"
                                    className="w-full text-xs"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleRenameCommit();
                                        }
                                        if (e.key === 'Escape') {
                                            close();
                                        }
                                    }}
                                    onBlur={handleRenameCommit}
                                    autoFocus
                                />
                            </div>
                        ) : showColorPicker ? (
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
                        ) : showInputMon ? (
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
                        ) : (
                            actions.map((item, i) =>
                                item.label === '---' ? (
                                    <DawMenuSeparator key={i} className="border-border/50" />
                                ) : (
                                    <DawMenuButton
                                        key={i}
                                        role="menuitem"
                                        tone={'destructive' in item && item.destructive ? 'danger' : 'default'}
                                        onClick={(item as MenuItem).action}
                                    >
                                        {item.label}
                                    </DawMenuButton>
                                )
                            )
                        )}
                    </div>
                </>
            ) : null}
        </div>
    );
};
