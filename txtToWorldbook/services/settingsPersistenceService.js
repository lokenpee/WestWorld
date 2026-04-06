export function createSettingsPersistenceService(deps) {
    const {
        AppState,
        defaultSettings,
        updateSettingsUI,
        updateChapterRegexUI,
        handleProviderChange,
    } = deps;

    function saveCurrentSettings() {
        AppState.settings.chunkSize = parseInt(document.getElementById('ttw-chunk-size')?.value) || 8000;
        AppState.settings.apiTimeout = (parseInt(document.getElementById('ttw-api-timeout')?.value) || 120) * 1000;
        AppState.processing.incrementalMode = document.getElementById('ttw-incremental-mode')?.checked ?? true;
        AppState.processing.volumeMode = document.getElementById('ttw-volume-mode')?.checked ?? false;
        AppState.settings.useVolumeMode = AppState.processing.volumeMode;
        AppState.settings.enablePlotOutline = document.getElementById('ttw-enable-plot')?.checked ?? false;
        AppState.settings.enableLiteraryStyle = document.getElementById('ttw-enable-style')?.checked ?? false;
        AppState.settings.customWorldbookPrompt = document.getElementById('ttw-worldbook-prompt')?.value || '';
        AppState.settings.customPlotPrompt = document.getElementById('ttw-plot-prompt')?.value || '';
        AppState.settings.customStylePrompt = document.getElementById('ttw-style-prompt')?.value || '';
        AppState.settings.useTavernApi = document.getElementById('ttw-use-tavern-api')?.checked ?? true;
        AppState.settings.parallelEnabled = AppState.config.parallel.enabled;
        AppState.settings.parallelConcurrency = AppState.config.parallel.concurrency;
        AppState.settings.parallelMode = AppState.config.parallel.mode;
        AppState.settings.categoryLightSettings = { ...AppState.config.categoryLight };
        AppState.settings.forceChapterMarker = document.getElementById('ttw-force-chapter-marker')?.checked ?? true;
        AppState.settings.chapterRegexPattern = document.getElementById('ttw-chapter-regex')?.value || AppState.config.chapterRegex.pattern;
        AppState.settings.defaultWorldbookEntriesUI = AppState.persistent.defaultEntries;
        AppState.settings.categoryDefaultConfig = AppState.config.categoryDefault;
        AppState.settings.entryPositionConfig = AppState.config.entryPosition;
        AppState.settings.customSuffixPrompt = document.getElementById('ttw-suffix-prompt')?.value || '';
        AppState.settings.customApiProvider = document.getElementById('ttw-api-provider')?.value || 'openai-compatible';
        AppState.settings.customApiKey = document.getElementById('ttw-api-key')?.value || '';
        AppState.settings.customApiEndpoint = document.getElementById('ttw-api-endpoint')?.value || '';
        const apiMaxTokens = parseInt(document.getElementById('ttw-api-max-tokens')?.value, 10);
        AppState.settings.customApiMaxTokens = Number.isFinite(apiMaxTokens) ? Math.max(1, Math.min(8192, apiMaxTokens)) : 2048;

        const modelSelectContainer = document.getElementById('ttw-model-select-container');
        const modelSelect = document.getElementById('ttw-model-select');
        const modelInput = document.getElementById('ttw-api-model');
        if (modelSelectContainer && modelSelectContainer.style.display !== 'none' && modelSelect?.value) {
            AppState.settings.customApiModel = modelSelect.value;
            if (modelInput) modelInput.value = modelSelect.value;
        } else {
            AppState.settings.customApiModel = modelInput?.value || 'gemini-2.5-flash';
        }

        try {
            localStorage.setItem('storyweaverTxtToWorldbookSettings', JSON.stringify(AppState.settings));
        } catch (e) { }

        AppState.settings.allowRecursion = document.getElementById('ttw-allow-recursion')?.checked ?? false;
        AppState.settings.filterResponseTags = document.getElementById('ttw-filter-tags')?.value || 'thinking,/think';
        AppState.settings.debugMode = document.getElementById('ttw-debug-mode')?.checked ?? false;
        AppState.settings.plotOutlineExportConfig = AppState.config.plotOutline;
    }

    function loadSavedSettings() {
        try {
            const saved = localStorage.getItem('storyweaverTxtToWorldbookSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                AppState.settings = { ...defaultSettings, ...parsed };

                // 迁移旧默认配置到更稳妥的新默认（仅迁移历史默认值，不覆盖用户自定义值）
                if (parsed.chunkSize === 15000) {
                    AppState.settings.chunkSize = 8000;
                }
                if (parsed.parallelConcurrency === 3) {
                    AppState.settings.parallelConcurrency = 1;
                }

                AppState.processing.volumeMode = AppState.settings.useVolumeMode || false;
                AppState.config.parallel.enabled = AppState.settings.parallelEnabled !== undefined ? AppState.settings.parallelEnabled : true;
                AppState.config.parallel.concurrency = AppState.settings.parallelConcurrency || 1;
                AppState.config.parallel.mode = AppState.settings.parallelMode || 'independent';
                const maxTokens = parseInt(AppState.settings.customApiMaxTokens, 10);
                AppState.settings.customApiMaxTokens = Number.isFinite(maxTokens)
                    ? Math.max(1, Math.min(8192, maxTokens))
                    : 2048;

                if (AppState.settings.chapterRegexPattern) {
                    AppState.config.chapterRegex.pattern = AppState.settings.chapterRegexPattern;
                }
                if (AppState.settings.defaultWorldbookEntriesUI) {
                    AppState.persistent.defaultEntries = AppState.settings.defaultWorldbookEntriesUI;
                }
                if (AppState.settings.categoryDefaultConfig) {
                    AppState.config.categoryDefault = AppState.settings.categoryDefaultConfig;
                }
                if (AppState.settings.entryPositionConfig) {
                    AppState.config.entryPosition = AppState.settings.entryPositionConfig;
                }
                if (AppState.settings.plotOutlineExportConfig) {
                    AppState.config.plotOutline = AppState.settings.plotOutlineExportConfig;
                }
            }
        } catch (e) { }

        updateSettingsUI();
        updateChapterRegexUI();
        handleProviderChange();
    }

    return {
        saveCurrentSettings,
        loadSavedSettings,
    };
}
