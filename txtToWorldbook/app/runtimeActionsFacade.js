export function createRuntimeActionsFacade(deps = {}) {
    const {
        AppState,
        ErrorHandler,
        saveCurrentSettings,
        handleStartProcessing,
        handleStartDirectorProcessing,
        replaceAndCleanService,
        entryConfigModals,
    } = deps;

    function clampStartIndex(index) {
        const queueLength = AppState.memory.queue.length;
        if (queueLength <= 0) return 0;
        return Math.max(0, Math.min(index, queueLength - 1));
    }

    function worldbookDone(memory) {
        return memory?.processed === true && memory?.failed !== true;
    }

    function directorStatus(memory) {
        const status = String(memory?.chapterOutlineStatus || '').trim().toLowerCase();
        return status || 'pending';
    }

    function resolveWorldbookStartIndex() {
        if (AppState.memory.userSelectedIndex !== null) {
            return clampStartIndex(AppState.memory.userSelectedIndex);
        }

        const firstPending = AppState.memory.queue.findIndex((memory) => !worldbookDone(memory));
        return firstPending === -1 ? 0 : clampStartIndex(firstPending);
    }

    function resolveDirectorStartIndex() {
        const firstPending = AppState.memory.queue.findIndex((memory) => {
            const status = directorStatus(memory);
            return status !== 'done' && status !== 'failed';
        });
        return firstPending === -1 ? 0 : clampStartIndex(firstPending);
    }

    function showCleanTagsModal() {
        if (!replaceAndCleanService) return;
        replaceAndCleanService.showCleanTagsModal();
    }

    function showBatchDeleteRepeatedSegmentsModal() {
        if (!replaceAndCleanService) return;
        if (typeof replaceAndCleanService.showBatchDeleteRepeatedSegmentsModal !== 'function') return;
        replaceAndCleanService.showBatchDeleteRepeatedSegmentsModal();
    }

    function previewRepeatedSegmentsCleanup(inputText, rangeMode = 'all', selectedIndices = []) {
        if (!replaceAndCleanService) {
            return { ok: false, error: '清洗服务未初始化' };
        }
        if (typeof replaceAndCleanService.previewRepeatedSegmentsCleanup !== 'function') {
            return { ok: false, error: '当前版本不支持预览清洗' };
        }
        return replaceAndCleanService.previewRepeatedSegmentsCleanup({
            inputText,
            rangeMode,
            selectedIndices,
        });
    }

    function executeRepeatedSegmentsCleanup(segments = [], chapterIndices = []) {
        if (!replaceAndCleanService) {
            return { ok: false, error: '清洗服务未初始化' };
        }
        if (typeof replaceAndCleanService.executeRepeatedSegmentsCleanup !== 'function') {
            return { ok: false, error: '当前版本不支持执行清洗' };
        }
        return replaceAndCleanService.executeRepeatedSegmentsCleanup({
            segments,
            chapterIndices,
        });
    }

    function showEntryConfigModal(category, entryName) {
        if (!entryConfigModals) return;
        entryConfigModals.showEntryConfigModal(category, entryName);
    }

    function showPlotOutlineConfigModal() {
        if (!entryConfigModals) return;
        entryConfigModals.showPlotOutlineConfigModal();
    }

    function showCategoryConfigModal(category) {
        if (!entryConfigModals) return;
        entryConfigModals.showCategoryConfigModal(category);
    }

    async function handleStartConversion() {
        saveCurrentSettings();

        if (AppState.processing.isRunning) {
            ErrorHandler.showUserError('当前已有处理任务运行中，请先停止后再启动新的提取流程');
            return;
        }

        if (AppState.memory.queue.length === 0) {
            ErrorHandler.showUserError('请先上传文件');
            return;
        }

        if (!AppState.settings.useTavernApi) {
            const provider = AppState.settings.customApiProvider;
            if ((provider === 'gemini' || provider === 'anthropic') && !AppState.settings.customApiKey) {
                ErrorHandler.showUserError('请先设置 API Key');
                return;
            }
        }

        AppState.memory.startIndex = resolveWorldbookStartIndex();

        await handleStartProcessing({ mode: 'worldbook-only' });
    }

    async function handleStartDirectorConversion() {
        saveCurrentSettings();

        if (AppState.processing.isRunning) {
            const currentMode = String(AppState.processing.currentMode || 'both');
            if (currentMode === 'worldbook-only') {
                if (AppState.processing.directorOnDemand) {
                    ErrorHandler.showUserSuccess('导演切拍已追加到当前任务中');
                    return;
                }

                const directorStartIndex = resolveDirectorStartIndex();
                if (typeof handleStartDirectorProcessing === 'function') {
                    const started = await handleStartDirectorProcessing({
                        mode: 'director-only',
                        appendOnRunning: true,
                        startIndex: directorStartIndex,
                    });
                    if (!started) {
                        ErrorHandler.showUserError('当前状态无法追加导演切拍，请稍后重试');
                        return;
                    }
                } else {
                    ErrorHandler.showUserError('导演处理服务未初始化，无法追加导演切拍');
                    return;
                }
                ErrorHandler.showUserSuccess(`已追加导演切拍：从第${directorStartIndex + 1}章起并行处理`);
                return;
            }

            ErrorHandler.showUserError('当前已有处理任务运行中，不能再启动新的导演流程');
            return;
        }

        if (AppState.memory.queue.length === 0) {
            ErrorHandler.showUserError('请先上传文件');
            return;
        }

        if (!AppState.settings.useTavernApi) {
            const provider = AppState.settings.customApiProvider;
            if ((provider === 'gemini' || provider === 'anthropic') && !AppState.settings.customApiKey) {
                ErrorHandler.showUserError('请先设置 API Key');
                return;
            }
        }

        AppState.memory.startIndex = resolveDirectorStartIndex();
        AppState.memory.userSelectedIndex = null;

        if (typeof handleStartDirectorProcessing === 'function') {
            await handleStartDirectorProcessing({ mode: 'director-only' });
            return;
        }

        await handleStartProcessing({ mode: 'director-only' });
    }

    return {
        showCleanTagsModal,
        showBatchDeleteRepeatedSegmentsModal,
        previewRepeatedSegmentsCleanup,
        executeRepeatedSegmentsCleanup,
        showEntryConfigModal,
        showPlotOutlineConfigModal,
        showCategoryConfigModal,
        handleStartConversion,
        handleStartDirectorConversion,
    };
}
