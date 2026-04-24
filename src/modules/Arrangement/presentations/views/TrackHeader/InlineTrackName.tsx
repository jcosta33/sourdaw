import { type ReactElement, useState, useRef, useEffect } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';

import { type Track } from '../../../models/Track';
import { renameTrack } from '../../../useCases/renameTrack';

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
                onChange={(event) => setValue(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    }
                    if (event.key === 'Escape') {
                        cancel();
                    }
                }}
                onClick={(event) => event.stopPropagation()}
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
            onDoubleClick={(event) => {
                event.stopPropagation();
                setValue(track.name);
                setEditing(true);
            }}
            title="Double-click to rename"
        >
            {track.name}
        </span>
    );
};
