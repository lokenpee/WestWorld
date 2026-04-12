export function createExportFormatService(deps = {}) {
    const {
        AppState,
        naturalSortEntryNames,
        getCategoryLightState,
        getCategoryAutoIncrement,
        getCategoryBaseOrder,
        getEntryConfig,
    } = deps;

    function convertToSillyTavernFormat(worldbook) {
        const normalizeRoleType = (value) => {
            const role = String(value || '').trim();
            if (!role) return '';
            if (role.includes('主角')) return '主角';
            if (role.includes('重要配角')) return '重要配角';
            if (role.includes('普通配角') || role.includes('配角')) return '普通配角';
            if (role.toUpperCase() === 'NPC' || role.includes('NPC') || role.includes('路人') || role.includes('龙套')) return 'NPC';
            return '';
        };

        const entries = [];
        let entryId = 0;
        const categoryEntryIndex = {};

        for (const [category, categoryData] of Object.entries(worldbook)) {
            if (typeof categoryData !== 'object' || categoryData === null) continue;

            const isGreenLight = getCategoryLightState(category);
            const autoIncrement = getCategoryAutoIncrement(category);
            const baseOrder = getCategoryBaseOrder(category);

            if (!categoryEntryIndex[category]) {
                categoryEntryIndex[category] = 0;
            }

            for (const [itemName, itemData] of naturalSortEntryNames(Object.keys(categoryData)).map((name) => [name, categoryData[name]])) {
                if (typeof itemData !== 'object' || itemData === null) continue;
                if (!(itemData.关键词 && itemData.内容)) continue;

                let keywords = Array.isArray(itemData.关键词) ? itemData.关键词 : [itemData.关键词];
                keywords = keywords.map((k) => String(k).trim()).filter((k) => k.length > 0 && k.length <= 50);
                if (keywords.length === 0) keywords.push(itemName);

                const config = getEntryConfig(category, itemName);

                let actualOrder;
                if (autoIncrement) {
                    actualOrder = baseOrder + categoryEntryIndex[category];
                    categoryEntryIndex[category]++;
                } else {
                    actualOrder = config.order !== undefined ? config.order : baseOrder;
                }

                entries.push({
                    uid: entryId++,
                    key: [...new Set(keywords)],
                    keysecondary: [],
                    comment: `${category} - ${itemName}`,
                    content: String(itemData.内容).trim(),
                    constant: !isGreenLight,
                    selective: isGreenLight,
                    selectiveLogic: 0,
                    addMemo: true,
                    order: actualOrder,
                    position: config.position !== undefined ? config.position : 0,
                    disable: false,
                    excludeRecursion: !AppState.settings.allowRecursion,
                    preventRecursion: !AppState.settings.allowRecursion,
                    delayUntilRecursion: false,
                    probability: 100,
                    depth: config.depth !== undefined ? config.depth : 4,
                    group: `${category}_${itemName}`,
                    groupOverride: false,
                    groupWeight: 100,
                    useGroupScoring: null,
                    scanDepth: null,
                    caseSensitive: false,
                    matchWholeWords: false,
                    automationId: '',
                    role: 0,
                    westworldRoleType: category === '角色' ? (normalizeRoleType(itemData['角色类型']) || '普通配角') : '',
                    storyweaverRoleType: category === '角色' ? (normalizeRoleType(itemData['角色类型']) || '普通配角') : '',
                    vectorized: false,
                    sticky: null,
                    cooldown: null,
                    delay: null,
                });
            }
        }

        return {
            entries,
            originalData: { name: '小说转换的世界书', description: '由TXT转世界书功能生成', version: 1, author: 'WestWorld' },
        };
    }

    return {
        convertToSillyTavernFormat,
    };
}
