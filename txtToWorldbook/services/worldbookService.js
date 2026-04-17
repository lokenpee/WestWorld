import { mergeContentByFieldFusion } from './nameNormalizationService.js';

export function createWorldbookService(deps = {}) {
    const {
        AppState,
        getIncrementalMode = () => false,
        saveHistory = async () => {},
        debugLog = () => {},
    } = deps;

    function safeString(value) {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    function normalizeFieldToken(fieldName) {
        const raw = safeString(fieldName).trim();
        if (!raw) return '';
        const compact = raw
            .toLowerCase()
            .replace(/[\s_\-（）()【】\[\]{}]/g, '')
            .replace(/(?:补充|扩展|说明|信息)\d*$/g, '');

        if (/^(姓名|人物名称|角色名称|名字|名称)$/.test(compact)) return '名称';
        if (/^(台词|语录|话语示例|说话风格)$/.test(compact)) return '话语示例';
        if (/^(履历|经历|背景|背景故事|过往)$/.test(compact)) return '背景故事';
        if (/^(外貌|形象|外形)$/.test(compact)) return '外貌';
        if (/^(能力|技能|特长)$/.test(compact)) return '能力';
        if (/^(性格|性格特征)$/.test(compact)) return '性格';

        return compact;
    }

    function getAllowedFieldSetByCategory(categoryName) {
        const categories = AppState?.persistent?.customCategories;
        if (!Array.isArray(categories) || !categoryName) return null;
        const category = categories.find((item) => item?.name === categoryName);
        const guide = safeString(category?.contentGuide);
        if (!guide.trim()) return null;

        const fields = new Set();
        const boldRegex = /\*\*\s*([^*\n:：]{1,40})\s*\*\*\s*[:：]/g;
        let match;
        while ((match = boldRegex.exec(guide)) !== null) {
            const key = normalizeFieldToken(match[1]);
            if (key) fields.add(key);
        }

        const plainRegex = /^(?:[-*•\d.()（）一二三四五六七八九十、\s]+)?([^:：\n]{1,40})\s*[:：]\s*$/gmu;
        while ((match = plainRegex.exec(guide)) !== null) {
            const key = normalizeFieldToken(match[1]);
            if (key) fields.add(key);
        }

        return fields.size > 0 ? fields : null;
    }

    function sanitizeStructuredContentByCategory(content, categoryName) {
        const raw = safeString(content);
        if (!raw.trim()) return raw;

        const allowedFields = getAllowedFieldSetByCategory(categoryName);
        if (!(allowedFields instanceof Set) || allowedFields.size === 0) return raw;

        const lines = raw.split(/\r?\n/);
        const output = [];
        let currentFieldAllowed = false;
        let seenStructuredField = false;

        for (const line of lines) {
            const fieldMatch = line.match(/^(?:[-*•\d.()（）一二三四五六七八九十、\s]+)?(?:\*\*)?\s*([^:：\n]{1,40}?)\s*(?:\*\*)?\s*[:：](.*)$/u);
            if (fieldMatch) {
                seenStructuredField = true;
                const fieldKey = normalizeFieldToken(fieldMatch[1]);
                currentFieldAllowed = !!fieldKey && allowedFields.has(fieldKey);
                if (currentFieldAllowed) {
                    output.push(line);
                }
                continue;
            }

            if (currentFieldAllowed) {
                output.push(line);
            }
        }

        if (!seenStructuredField) return raw;
        const sanitized = output.join('\n').trim();
        return sanitized || raw;
    }

    function normalizeWorldbookEntry(entry, categoryName = '') {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        if (entry.content !== undefined && entry['内容'] !== undefined) {
            const contentLen = String(entry.content || '').length;
            const neirongLen = String(entry['内容'] || '').length;
            if (contentLen > neirongLen) entry['内容'] = entry.content;
            delete entry.content;
        } else if (entry.content !== undefined) {
            entry['内容'] = entry.content;
            delete entry.content;
        }

        if (entry['内容'] !== undefined) {
            entry['内容'] = sanitizeStructuredContentByCategory(entry['内容'], categoryName);
        }

        if (entry['角色类型'] !== undefined) {
            const roleType = normalizeRoleType(entry['角色类型']);
            if (roleType) {
                entry['角色类型'] = roleType;
            } else {
                delete entry['角色类型'];
            }
        }

        return entry;
    }

    function normalizeRoleType(value) {
        const text = String(value || '').trim();
        if (!text) return '';

        if (text.includes('主角')) return '主角';
        if (text.includes('重要配角')) return '重要配角';
        if (text.includes('普通配角') || text.includes('配角')) return '普通配角';
        if (text.toUpperCase() === 'NPC' || text.includes('路人') || text.includes('龙套') || text.includes('NPC')) return 'NPC';
        return '';
    }

    function normalizeWorldbookData(data) {
        if (!data || typeof data !== 'object') return data;
        for (const category in data) {
            if (typeof data[category] === 'object' && data[category] !== null && !Array.isArray(data[category])) {
                if (data[category]['关键词'] || data[category]['内容'] || data[category].content) {
                    normalizeWorldbookEntry(data[category], category);
                } else {
                    for (const entryName in data[category]) {
                        if (typeof data[category][entryName] === 'object') {
                            normalizeWorldbookEntry(data[category][entryName], category);
                            if (category === '角色' && !data[category][entryName]['角色类型']) {
                                data[category][entryName]['角色类型'] = '普通配角';
                            }
                        }
                    }
                }
            }
        }
        return data;
    }

    function mergeWorldbookData(target, source) {
        normalizeWorldbookData(source);
        for (const key in source) {
            if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                if (!target[key]) target[key] = {};
                mergeWorldbookData(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
    }

    function mergeWorldbookDataIncremental(target, source) {
        normalizeWorldbookData(source);
        for (const category in source) {
            if (typeof source[category] !== 'object' || source[category] === null) continue;
            if (!target[category]) target[category] = {};
            for (const entryName in source[category]) {
                const sourceEntry = source[category][entryName];
                if (typeof sourceEntry !== 'object' || sourceEntry === null) continue;
                if (target[category][entryName]) {
                    const targetEntry = target[category][entryName];
                    if (Array.isArray(sourceEntry['关键词']) && Array.isArray(targetEntry['关键词'])) {
                        targetEntry['关键词'] = [...new Set([...targetEntry['关键词'], ...sourceEntry['关键词']])];
                    } else if (Array.isArray(sourceEntry['关键词'])) {
                        targetEntry['关键词'] = sourceEntry['关键词'];
                    }
                    if (sourceEntry['内容']) {
                        const existingContent = targetEntry['内容'] || '';
                        const newContent = sourceEntry['内容'];
                        const mergedContent = mergeContentByFieldFusion(existingContent, newContent);
                        targetEntry['内容'] = sanitizeStructuredContentByCategory(mergedContent, category);
                    }

                    if (category === '角色') {
                        const sourceRoleType = normalizeRoleType(sourceEntry['角色类型']);
                        const targetRoleType = normalizeRoleType(targetEntry['角色类型']);
                        if (sourceRoleType) {
                            targetEntry['角色类型'] = sourceRoleType;
                        } else if (!targetRoleType) {
                            targetEntry['角色类型'] = '普通配角';
                        }
                    }
                } else {
                    target[category][entryName] = JSON.parse(JSON.stringify(sourceEntry));
                    if (category === '角色' && !target[category][entryName]['角色类型']) {
                        target[category][entryName]['角色类型'] = '普通配角';
                    }
                }
            }
        }
    }

    function findChangedEntries(oldWorldbook, newWorldbook) {
        const changes = [];
        for (const category in newWorldbook) {
            const oldCategory = oldWorldbook[category] || {};
            const newCategory = newWorldbook[category];
            for (const entryName in newCategory) {
                const oldEntry = oldCategory[entryName];
                const newEntry = newCategory[entryName];
                if (!oldEntry) {
                    changes.push({ type: 'add', category, entryName, oldValue: null, newValue: newEntry });
                } else if (JSON.stringify(oldEntry) !== JSON.stringify(newEntry)) {
                    changes.push({ type: 'modify', category, entryName, oldValue: oldEntry, newValue: newEntry });
                }
            }
        }
        for (const category in oldWorldbook) {
            const oldCategory = oldWorldbook[category];
            const newCategory = newWorldbook[category] || {};
            for (const entryName in oldCategory) {
                if (!newCategory[entryName]) {
                    changes.push({ type: 'delete', category, entryName, oldValue: oldCategory[entryName], newValue: null });
                }
            }
        }
        return changes;
    }

    function deepClone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function collectTouchedEntryRefs(source) {
        const refs = [];
        if (!source || typeof source !== 'object') return refs;
        for (const category in source) {
            const entries = source[category];
            if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
            for (const entryName in entries) {
                const entry = entries[entryName];
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
                refs.push({ category, entryName });
            }
        }
        return refs;
    }

    function ensureSnapshotCategory(snapshot, category) {
        if (!snapshot[category]) snapshot[category] = {};
        return snapshot[category];
    }

    async function mergeWorldbookDataWithHistory(options) {
        const { target, source, memoryIndex, memoryTitle } = options;
        debugLog(`合并世界书[${memoryTitle}] 开始, 构建触达条目快照...`);
        const touchedRefs = collectTouchedEntryRefs(source);
        const fallbackPreviousWorldbook = touchedRefs.length === 0 ? deepClone(target) : null;
        const previousEntryMap = new Map();
        for (const ref of touchedRefs) {
            const key = `${ref.category}::${ref.entryName}`;
            const oldValue = target?.[ref.category]?.[ref.entryName];
            previousEntryMap.set(key, deepClone(oldValue));
        }

        if (getIncrementalMode()) {
            mergeWorldbookDataIncremental(target, source);
        } else {
            mergeWorldbookData(target, source);
        }

        if (touchedRefs.length === 0) {
            const changedEntries = findChangedEntries(fallbackPreviousWorldbook || {}, target);
            if (changedEntries.length > 0) {
                debugLog(`合并世界书[${memoryTitle}] 发现${changedEntries.length}处变更, 保存历史(全量回退模式)...`);
                await saveHistory(memoryIndex, memoryTitle, fallbackPreviousWorldbook || {}, target, changedEntries, { snapshotMode: 'full' });
            }
            debugLog(`合并世界书[${memoryTitle}] 全部完成`);
            return changedEntries;
        }

        debugLog(`合并世界书[${memoryTitle}] 合并完成, 计算差异...`);
        const changedEntries = [];
        const previousWorldbook = {};
        const newWorldbook = {};

        for (const ref of touchedRefs) {
            const key = `${ref.category}::${ref.entryName}`;
            const oldValue = previousEntryMap.get(key);
            const newValue = deepClone(target?.[ref.category]?.[ref.entryName]);
            const hadOld = oldValue !== undefined;
            const hasNew = newValue !== undefined;

            if (!hadOld && !hasNew) continue;

            if (hadOld) {
                ensureSnapshotCategory(previousWorldbook, ref.category)[ref.entryName] = oldValue;
            }
            if (hasNew) {
                ensureSnapshotCategory(newWorldbook, ref.category)[ref.entryName] = newValue;
            }

            if (!hadOld && hasNew) {
                changedEntries.push({ type: 'add', category: ref.category, entryName: ref.entryName, oldValue: null, newValue });
                continue;
            }

            if (hadOld && !hasNew) {
                changedEntries.push({ type: 'delete', category: ref.category, entryName: ref.entryName, oldValue, newValue: null });
                continue;
            }

            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                changedEntries.push({ type: 'modify', category: ref.category, entryName: ref.entryName, oldValue, newValue });
            }
        }

        if (changedEntries.length > 0) {
            debugLog(`合并世界书[${memoryTitle}] 发现${changedEntries.length}处变更, 保存历史...`);
            await saveHistory(memoryIndex, memoryTitle, previousWorldbook, newWorldbook, changedEntries, { snapshotMode: 'delta' });
        }

        debugLog(`合并世界书[${memoryTitle}] 全部完成`);
        return changedEntries;
    }

    return {
        normalizeWorldbookEntry,
        normalizeWorldbookData,
        mergeWorldbookData,
        mergeWorldbookDataIncremental,
        findChangedEntries,
        mergeWorldbookDataWithHistory,
    };
}
