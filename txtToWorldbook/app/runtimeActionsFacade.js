export function createRuntimeActionsFacade(deps = {}) {
    const {
        AppState,
        ErrorHandler,
        saveCurrentSettings,
        handleStartProcessing,
        replaceAndCleanService,
        entryConfigModals,
    } = deps;

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

        await handleStartProcessing();
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
    };
}
