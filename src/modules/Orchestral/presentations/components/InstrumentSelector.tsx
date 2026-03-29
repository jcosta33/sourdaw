/**
 * InstrumentSelector — visual grid for choosing orchestral instruments.
 *
 * Level 1 (Play) component: shows instrument families as cards
 * with musical descriptions, not technical details.
 */
import { type ReactElement } from 'react';
import { type InstrumentId } from '../../models/OrchestraPatch';
import { loadInstrument } from '../../useCases/loadPreset';

type InstrumentOption = {
    id: InstrumentId;
    label: string;
    family: string;
};

const INSTRUMENTS: InstrumentOption[] = [
    { id: 'violin-1', label: 'Violins I', family: 'Strings' },
    { id: 'violin-2', label: 'Violins II', family: 'Strings' },
    { id: 'viola', label: 'Violas', family: 'Strings' },
    { id: 'cello', label: 'Cellos', family: 'Strings' },
    { id: 'double-bass', label: 'Basses', family: 'Strings' },
    { id: 'trumpet', label: 'Trumpets', family: 'Brass' },
    { id: 'horn', label: 'Horns', family: 'Brass' },
    { id: 'trombone', label: 'Trombones', family: 'Brass' },
    { id: 'tuba', label: 'Tuba', family: 'Brass' },
    { id: 'flute', label: 'Flutes', family: 'Woodwinds' },
    { id: 'oboe', label: 'Oboes', family: 'Woodwinds' },
    { id: 'clarinet', label: 'Clarinets', family: 'Woodwinds' },
    { id: 'bassoon', label: 'Bassoons', family: 'Woodwinds' },
    { id: 'timpani', label: 'Timpani', family: 'Percussion' },
    { id: 'harp', label: 'Harp', family: 'Percussion' },
];

type InstrumentSelectorProps = {
    instrumentId: InstrumentId;
};

export const InstrumentSelector = ({ instrumentId }: InstrumentSelectorProps): ReactElement => {
    const handleSelect = (id: InstrumentId): void => {
        loadInstrument(id);
    };

    // Group by family.
    const families = new Map<string, InstrumentOption[]>();
    for (const inst of INSTRUMENTS) {
        const group = families.get(inst.family) ?? [];
        group.push(inst);
        families.set(inst.family, group);
    }

    return (
        <div className="flex flex-col gap-2 p-2 overflow-y-auto">
            {Array.from(families.entries()).map(([family, instruments]) => (
                <div key={family}>
                    <span className="text-[10px] text-zinc-600 uppercase tracking-wider px-1">
                        {family}
                    </span>
                    <div className="flex flex-col gap-0.5 mt-1">
                        {instruments.map((inst) => (
                            <button
                                key={inst.id}
                                className={`text-left px-2 py-1 rounded text-xs transition-colors ${
                                    instrumentId === inst.id
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                                }`}
                                onClick={() => handleSelect(inst.id)}
                            >
                                {inst.label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};
