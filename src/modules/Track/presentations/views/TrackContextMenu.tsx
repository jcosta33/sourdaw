import { type ReactElement,
    type MouseEvent, type ReactNode, useState, useRef, useEffect } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { removeTrack } from '../../useCases/removeTrack';
import { toggleSoloSafe } from '../../useCases/toggleTrackState';
import { addClip } from '#/modules/Clip/useCases/clipUseCases';
import { renameTrack } from '../../useCases/renameTrack';
import { freezeTrack, unfreezeTrack, bounceInPlace, bounceToNewTrack } from '../../useCases/freezeBounce';
import { armTrack } from '../../useCases/recordingUseCases';
import { addTrack } from '../../useCases/addTrack';
import { saveTrackAsTemplate } from '../../useCases/trackTemplateUseCases';
import { setTrackColor, setInputMonitoring } from '../../useCases/setTrackGainPan';
import { decodeAudioFile } from '../../useCases/trackViewActions';
import { importMidiFile } from '#/modules/Midi/useCases/importMidiFile';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type Track, type InputMonitoring } from '../../models/Track';

const TRACK_COLORS = [
    'oklch(0.40 0.08 250)',
    'oklch(0.38 0.09 20)',
    'oklch(0.40 0.08 150)',
    'oklch(0.40 0.08 70)',
    'oklch(0.38 0.08 300)',
    'oklch(0.38 0.08 340)',
    'oklch(0.40 0.07 200)',
    'oklch(0.39 0.08 45)',
    'oklch(0.40 0.07 170)',
    'oklch(0.38 0.08 270)',
    'oklch(0.39 0.07 110)',
    'oklch(0.38 0.09 0)',
];

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

    useEffect(() => {
        if (!position) {
            return;
        }
        const handleEscape = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                close();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [position]);

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
                removeTrack(track.id);
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

            {position && (
                <>
                    <div className="fixed inset-0 z-40" onClick={close} />
                    <div
                        className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 shadow-lg"
                        style={{ left: position.x, top: position.y }}
                        role="menu"
                    >
                        {renaming ? (
                            <div className="px-2 py-1">
                                <input
                                    className="w-full rounded bg-surface-overlay px-2 py-1 text-xs text-foreground outline-none ring-1 ring-ring"
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
                                <p className="text-[10px] text-muted-foreground mb-1.5">Track Color</p>
                                <div className="grid grid-cols-5 gap-1">
                                    {TRACK_COLORS.map((color) => (
                                        <button
                                            type="button"
                                            key={color}
                                            className={cn(
                                                'size-5 rounded-full border-2 transition-transform hover:scale-110',
                                                track.color === color ? 'border-foreground' : 'border-transparent'
                                            )}
                                            style={{ backgroundColor: color }}
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
                                <p className="text-[10px] text-muted-foreground px-2 mb-1">Input Monitoring</p>
                                {INPUT_MON_OPTIONS.map((opt) => (
                                    <button
                                        type="button"
                                        key={opt.value}
                                        role="menuitem"
                                        className={cn(
                                            'flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent',
                                            track.inputMonitoring === opt.value && 'bg-accent/50 font-medium'
                                        )}
                                        onClick={() => {
                                            setInputMonitoring(track.id, opt.value);
                                            close();
                                        }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            actions.map((item, i) =>
                                item.label === '---' ? (
                                    <div key={i} className="my-1 h-px bg-border" />
                                ) : (
                                    <button
                                        type="button"
                                        key={i}
                                        role="menuitem"
                                        className={cn(
                                            'flex w-full items-center rounded-sm px-2 py-1.5 text-xs',
                                            'hover:bg-accent',
                                            'destructive' in item &&
                                                item.destructive &&
                                                'text-destructive-foreground hover:bg-destructive/20'
                                        )}
                                        onClick={(item as MenuItem).action}
                                    >
                                        {item.label}
                                    </button>
                                )
                            )
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
