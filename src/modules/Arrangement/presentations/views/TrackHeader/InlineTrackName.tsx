import { type ReactElement, useState, useRef, useEffect } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { type Track } from '#/modules/Arrangement/models/Track';
import { renameTrack } from '#/modules/Arrangement';

type InlineTrackNameProps = {
    track: Track;
};

export const InlineTrackName = ({ track }: InlineTrackNameProps): ReactElement => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(track.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) {
            inputRef.current?.select();
        }
    }, [editing]);

    const commit = () => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== track.name) {
            renameTrack(track.id, trimmed);
        }
        setEditing(false);
    };

    const cancel = () => {
        setValue(track.name);
        setEditing(false);
    };

    if (editing) {
        return (
            <DawCompactInput
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        commit();
                    }
                    if (e.key === 'Escape') {
                        cancel();
                    }
                }}
                onClick={(e) => e.stopPropagation()}
                size="micro"
                className="flex-1 min-w-0 truncate bg-transparent px-0.5 text-xs font-medium text-foreground"
                aria-label={`Rename track ${track.name}`}
                autoFocus
            />
        );
    }

    return (
        <span
            className="flex-1 truncate text-xs font-medium text-foreground"
            onDoubleClick={(e) => {
                e.stopPropagation();
                setValue(track.name);
                setEditing(true);
            }}
            title="Double-click to rename"
        >
            {track.name}
        </span>
    );
};
