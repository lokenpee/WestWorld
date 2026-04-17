export function createStartButtonView(deps = {}) {
    const {
        AppState,
    } = deps;

    function updateStartButtonState(isProcessing) {
        const worldbookStartBtn = document.getElementById('ttw-start-btn');
        const directorStartBtn = document.getElementById('ttw-start-director-btn');
        if (!worldbookStartBtn && !directorStartBtn) return;

        if (!isProcessing && AppState.processing.activeTasks.size > 0) {
            return;
        }

        if (isProcessing) {
            const currentMode = String(AppState?.processing?.currentMode || 'both');
            const directorOnDemand = AppState?.processing?.directorOnDemand === true;
            if (worldbookStartBtn) {
                worldbookStartBtn.disabled = true;
                worldbookStartBtn.textContent = currentMode === 'director-only' ? '📚 等待中...' : '📚 处理中...';
            }
            if (directorStartBtn) {
                if (currentMode === 'worldbook-only' && !directorOnDemand) {
                    directorStartBtn.disabled = false;
                    directorStartBtn.textContent = '🎬 追加导演切拍';
                } else {
                    directorStartBtn.disabled = true;
                    directorStartBtn.textContent = '🎬 导演处理中...';
                }
            }
            return;
        }

        if (worldbookStartBtn) worldbookStartBtn.disabled = false;
        if (directorStartBtn) directorStartBtn.disabled = false;

        const directorStatus = (memory) => {
            const outlineStatus = String(memory?.chapterOutlineStatus || '').trim().toLowerCase();
            if (outlineStatus) return outlineStatus;
            return 'pending';
        };

        const worldbookDone = (memory) => memory?.processed === true && memory?.failed !== true;

        const firstWorldbookPending = AppState.memory.queue.findIndex((memory) => {
            return !worldbookDone(memory);
        });
        const firstDirectorPending = AppState.memory.queue.findIndex((memory) => {
            const status = directorStatus(memory);
            return status !== 'done' && status !== 'failed';
        });

        const hasWorldbookDone = AppState.memory.queue.some((memory) => worldbookDone(memory));
        const hasDirectorDone = AppState.memory.queue.some((memory) => directorStatus(memory) === 'done');

        if (worldbookStartBtn) {
            if (AppState.memory.userSelectedIndex !== null) {
                worldbookStartBtn.textContent = `▶️ 从第${AppState.memory.userSelectedIndex + 1}章开始提取`;
            } else if (hasWorldbookDone && firstWorldbookPending !== -1 && firstWorldbookPending < AppState.memory.queue.length) {
                worldbookStartBtn.textContent = `▶️ 继续提取世界书（第${firstWorldbookPending + 1}章）`;
            } else if (AppState.memory.queue.length > 0 && AppState.memory.queue.every((memory) => worldbookDone(memory))) {
                worldbookStartBtn.textContent = '📚 重新提取世界书';
            } else {
                worldbookStartBtn.textContent = '📚 仅提取世界书';
            }
        }

        if (directorStartBtn) {
            if (hasDirectorDone && firstDirectorPending !== -1 && firstDirectorPending < AppState.memory.queue.length) {
                directorStartBtn.textContent = `▶️ 继续导演切拍（第${firstDirectorPending + 1}章）`;
            } else if (
                AppState.memory.queue.length > 0
                && AppState.memory.queue.every((memory) => {
                    const status = directorStatus(memory);
                    return status === 'done' || status === 'failed';
                })
            ) {
                directorStartBtn.textContent = '🎬 重跑导演切拍';
            } else {
                directorStartBtn.textContent = '🎬 仅导演切拍';
            }
        }
    }

    return {
        updateStartButtonState,
    };
}
