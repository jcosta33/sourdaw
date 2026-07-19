type FreezeTask = {
    readonly trackId: string;
    readonly controller: AbortController;
    readonly authorityEpoch: number;
    readonly completion: Promise<void>;
    finish: () => void;
};

class FreezeTaskAuthority {
    readonly activeTasks = new Map<string, AbortController>();
    private authorityEpoch = 0;
    private readonly tasks = new Set<FreezeTask>();

    begin(trackId: string): FreezeTask {
        this.activeTasks.get(trackId)?.abort();
        const controller = new AbortController();
        let resolveCompletion!: () => void;
        const task: FreezeTask = {
            trackId,
            controller,
            authorityEpoch: this.authorityEpoch,
            completion: new Promise<void>((resolve) => {
                resolveCompletion = resolve;
            }),
            finish: resolveCompletion,
        };
        this.activeTasks.set(trackId, controller);
        this.tasks.add(task);
        return task;
    }

    owns(task: FreezeTask): boolean {
        return task.authorityEpoch === this.authorityEpoch && this.activeTasks.get(task.trackId) === task.controller;
    }

    isCurrent(task: FreezeTask): boolean {
        return this.owns(task) && !task.controller.signal.aborted;
    }

    abortTrack(trackId: string): void {
        const controller = this.activeTasks.get(trackId);
        if (!controller) {
            return;
        }
        this.activeTasks.delete(trackId);
        controller.abort();
    }

    finish(task: FreezeTask): void {
        if (this.activeTasks.get(task.trackId) === task.controller) {
            this.activeTasks.delete(task.trackId);
        }
        this.tasks.delete(task);
        task.finish();
    }

    has(trackId: string): boolean {
        return this.activeTasks.has(trackId);
    }

    revoke(): { trackIds: string[]; settled: Promise<void> } {
        this.authorityEpoch += 1;
        const tasks = [...this.tasks];
        this.activeTasks.clear();
        for (const task of tasks) {
            task.controller.abort();
        }
        return {
            trackIds: [...new Set(tasks.map((task) => task.trackId))],
            settled: Promise.all(tasks.map((task) => task.completion)).then(() => undefined),
        };
    }
}

export const freezeTaskAuthority = new FreezeTaskAuthority();
