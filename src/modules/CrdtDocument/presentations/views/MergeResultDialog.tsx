import { type ReactElement } from 'react';

import { type MergeOnOpenResult } from '../../useCases/mergeOnOpen';

type MergeResultDialogProps = {
    result: MergeOnOpenResult;
    onClose: () => void;
};

export const MergeResultDialog = ({ result, onClose }: MergeResultDialogProps): ReactElement => {
    if (!result.success) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="w-96 rounded-lg bg-zinc-900 p-6 shadow-xl">
                    <h2 className="mb-4 text-lg font-semibold text-white">Merge Failed</h2>
                    <p className="mb-4 text-sm text-zinc-400">
                        {result.error ?? 'An unknown error occurred during merge.'}
                    </p>
                    <div className="flex justify-end">
                        <button
                            onClick={onClose}
                            className="rounded bg-zinc-700 px-4 py-2 text-sm text-white hover:bg-zinc-600"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-96 rounded-lg bg-zinc-900 p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold text-white">Merge Complete</h2>
                <div className="mb-4 space-y-2 text-sm text-zinc-300">
                    {result.tracksAdded > 0 ? (
                        <p>{result.tracksAdded} new track{result.tracksAdded > 1 ? 's' : ''} added</p>
                    ) : null}
                    {result.documentsMerged > 0 ? (
                        <p>{result.documentsMerged} document{result.documentsMerged > 1 ? 's' : ''} merged</p>
                    ) : null}
                    {result.documentsNew > 0 ? (
                        <p>{result.documentsNew} new document{result.documentsNew > 1 ? 's' : ''} imported</p>
                    ) : null}
                    {result.documentsMerged === 0 && result.documentsNew === 0 ? (
                        <p className="text-zinc-500">No changes detected. The projects are already in sync.</p>
                    ) : null}
                </div>
                <div className="flex justify-end">
                    <button
                        onClick={onClose}
                        className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
