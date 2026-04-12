export function createCategoryLightService(deps) {
    const {
        AppState,
        storageKey = 'westworldTxtToWorldbookSettings',
    } = deps;
    const legacyStorageKey = 'storyweaverTxtToWorldbookSettings';

    function saveCategoryLightSettings() {
        AppState.settings.categoryLightSettings = { ...AppState.config.categoryLight };
        try {
            const serialized = JSON.stringify(AppState.settings);
            localStorage.setItem(storageKey, serialized);
            localStorage.setItem(legacyStorageKey, serialized);
        } catch (e) { }
    }

    function loadCategoryLightSettings() {
        if (AppState.settings.categoryLightSettings) {
            AppState.config.categoryLight = {
                ...AppState.config.categoryLight,
                ...AppState.settings.categoryLightSettings,
            };
        }
    }

    return {
        saveCategoryLightSettings,
        loadCategoryLightSettings,
    };
}
