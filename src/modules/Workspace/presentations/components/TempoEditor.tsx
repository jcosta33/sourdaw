import { type ReactElement, useState } from "react";
import { Input } from "#/components/ui/input";
import { useTransportState } from "#/modules/Transport/presentations/hooks/useTransportState";
import { setTempo } from "#/modules/Transport/useCases/setTempo";

export const TempoEditor = (): ReactElement => {
    const transport = useTransportState();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");

    const startEdit = () => {
        setValue(transport.tempo.toFixed(2));
        setEditing(true);
    };

    const commit = () => {
        const bpm = parseFloat(value);
        if (!isNaN(bpm) && bpm >= 20 && bpm <= 300) {
            setTempo(bpm);
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <div className="flex items-center gap-1 px-1">
                <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") setEditing(false);
                    }}
                    className="h-6 w-16 text-center font-mono text-xs"
                    min={20}
                    max={300}
                    step={0.01}
                    autoFocus
                    aria-label="Tempo BPM"
                />
                <span className="text-xs text-muted-foreground">BPM</span>
                <span className="text-xs text-muted-foreground">
                    {transport.timeSignatureNumerator}/{transport.timeSignatureDenominator}
                </span>
            </div>
        );
    }

    return (
        <button
            className="flex items-center gap-2 rounded px-1 hover:bg-accent/50 transition-colors"
            onClick={startEdit}
            aria-label={`Tempo: ${transport.tempo} BPM. Click to edit.`}
        >
            <span className="font-mono text-xs tabular-nums text-foreground">
                {transport.tempo.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">BPM</span>
            <span className="text-xs text-muted-foreground">
                {transport.timeSignatureNumerator}/{transport.timeSignatureDenominator}
            </span>
        </button>
    );
};
