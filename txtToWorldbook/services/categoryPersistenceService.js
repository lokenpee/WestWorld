export function createCategoryPersistenceService(deps) {
    const {
        AppState,
        MemoryHistoryDB,
        Logger,
        defaultWorldbookCategories,
        extendedCategoryNames = ['剧情大纲', '知识书', '文风配置', '地图环境', '剧情节点'],
    } = deps;

    const DEFAULT_CATEGORIES_FINGERPRINT_KEY = 'westworldTxtToWorldbookDefaultCategoriesFingerprint';

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function getDefaultCategoriesFingerprint() {
        const normalized = (defaultWorldbookCategories || []).map((category) => ({
            name: category?.name || '',
            isBuiltin: !!category?.isBuiltin,
            enabled: category?.enabled !== false,
            entryExample: category?.entryExample || '',
            keywordsExample: Array.isArray(category?.keywordsExample) ? category.keywordsExample : [],
            contentGuide: category?.contentGuide || '',
            defaultPosition: category?.defaultPosition ?? 0,
            defaultDepth: category?.defaultDepth ?? 4,
            defaultOrder: category?.defaultOrder ?? 100,
            autoIncrementOrder: !!category?.autoIncrementOrder,
        }));
        return JSON.stringify(normalized);
    }

    function getStoredDefaultCategoriesFingerprint() {
        try {
            return localStorage.getItem(DEFAULT_CATEGORIES_FINGERPRINT_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function setStoredDefaultCategoriesFingerprint(fingerprint) {
        try {
            localStorage.setItem(DEFAULT_CATEGORIES_FINGERPRINT_KEY, fingerprint || '');
        } catch (_) {
            // ignore
        }
    }

    function syncSavedCategoriesWithDefaults(savedCategories = []) {
        const defaults = Array.isArray(defaultWorldbookCategories) ? defaultWorldbookCategories : [];
        const defaultByName = new Map(defaults.map((category) => [category.name, category]));
        const synced = [];
        const seenDefaultNames = new Set();

        for (const saved of (Array.isArray(savedCategories) ? savedCategories : [])) {
            const defaultCategory = defaultByName.get(saved?.name);
            if (!defaultCategory) {
                synced.push(saved);
                continue;
            }

            seenDefaultNames.add(defaultCategory.name);
            const userGuide = (saved?.contentGuide || '').trim();
            const defaultGuide = (defaultCategory?.contentGuide || '').trim();
            synced.push({
                ...saved,
                isBuiltin: !!defaultCategory.isBuiltin,
                entryExample: defaultCategory.entryExample,
                keywordsExample: clone(defaultCategory.keywordsExample || []),
                contentGuide: userGuide || defaultGuide,
            });
        }

        for (const defaultCategory of defaults) {
            if (seenDefaultNames.has(defaultCategory.name)) continue;
            synced.push(clone(defaultCategory));
        }

        return synced;
    }

    async function saveCustomCategories() {
        try {
            await MemoryHistoryDB.saveCustomCategories(AppState.persistent.customCategories);
            Logger.info('Category', '自定义分类配置已保存');
        } catch (error) {
            Logger.error('Category', '保存自定义分类配置失败:', error);
        }
    }

    async function loadCustomCategories() {
        let hasLoadedSavedCategories = false;
        try {
            const saved = await MemoryHistoryDB.getCustomCategories();
            if (saved && Array.isArray(saved) && saved.length > 0) {
                AppState.persistent.customCategories = saved;
                hasLoadedSavedCategories = true;
            }
        } catch (error) {
            Logger.error('Category', '加载自定义分类配置失败:', error);
        }

        if (!hasLoadedSavedCategories) {
            AppState.persistent.customCategories = clone(defaultWorldbookCategories || []);
            await saveCustomCategories();
            setStoredDefaultCategoriesFingerprint(getDefaultCategoriesFingerprint());
            return;
        }

        const currentFingerprint = getDefaultCategoriesFingerprint();
        const storedFingerprint = getStoredDefaultCategoriesFingerprint();
        if (!storedFingerprint || storedFingerprint !== currentFingerprint) {
            AppState.persistent.customCategories = syncSavedCategoriesWithDefaults(AppState.persistent.customCategories);
            await saveCustomCategories();
            Logger.info('Category', '检测到默认分类配置变更，已同步内置分类字段配置');
        }
        setStoredDefaultCategoriesFingerprint(currentFingerprint);
    }

    async function resetToDefaultCategories() {
        AppState.persistent.customCategories = JSON.parse(JSON.stringify(defaultWorldbookCategories));
        await saveCustomCategories();
        setStoredDefaultCategoriesFingerprint(getDefaultCategoriesFingerprint());
        Logger.info('Category', '已重置为默认分类配置');
    }

    async function resetSingleCategory(index) {
        const category = AppState.persistent.customCategories[index];
        if (!category) return;

        const defaultCategory = defaultWorldbookCategories.find(item => item.name === category.name);
        if (defaultCategory) {
            AppState.persistent.customCategories[index] = JSON.parse(JSON.stringify(defaultCategory));
        } else {
            AppState.persistent.customCategories.splice(index, 1);
        }

        await saveCustomCategories();
    }

    function getEnabledCategories() {
        return AppState.persistent.customCategories.filter(category => category.enabled);
    }

    function generateDynamicJsonTemplate() {
        const enabledCategories = getEnabledCategories();
        let template = '{\n';
        const parts = [];

        for (const category of enabledCategories) {
            parts.push(`"${category.name}": {
"${category.entryExample}": {
"关键词": ${JSON.stringify(category.keywordsExample)},
"内容": "${category.contentGuide}"
}
}`);
        }

        template += parts.join(',\n');
        template += '\n}';
        return template;
    }

    function getEnabledCategoryNames() {
        const names = getEnabledCategories().map(category => category.name);
        names.push(...extendedCategoryNames);
        return names;
    }

    return {
        saveCustomCategories,
        loadCustomCategories,
        resetToDefaultCategories,
        resetSingleCategory,
        getEnabledCategories,
        generateDynamicJsonTemplate,
        getEnabledCategoryNames,
    };
}
