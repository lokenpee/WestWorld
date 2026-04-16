export function createMemoryHistoryDB(AppState, Logger) {
    const MemoryHistoryDB = {
        dbName: 'WestWorldTxtToWorldbookDB',
        legacyDbName: 'StoryWeaverTxtToWorldbookDB',
        storeName: 'history',
        metaStoreName: 'meta',
        stateStoreName: 'state',
        rollStoreName: 'rolls',
        categoriesStoreName: 'categories',
        entryRollStoreName: 'entryRolls', // 新增：条目级别Roll历史
        resolvedDbName: '',
        db: null,
        stateSaveThrottleMs: 10000,
        stateSaveTimer: null,
        stateSavePendingState: null,
        stateSavePendingResolvers: [],
        stateSavePendingRejectors: [],
        stateSaveFlushPromise: null,

        async resolveDbName() {
            if (this.resolvedDbName) return this.resolvedDbName;

            try {
                if (typeof indexedDB.databases === 'function') {
                    const dbList = await indexedDB.databases();
                    const hasNew = dbList.some((item) => item?.name === this.dbName);
                    const hasLegacy = dbList.some((item) => item?.name === this.legacyDbName);
                    this.resolvedDbName = hasNew ? this.dbName : (hasLegacy ? this.legacyDbName : this.dbName);
                    return this.resolvedDbName;
                }
            } catch (_e) {
                // Ignore and keep default database name.
            }

            this.resolvedDbName = this.dbName;
            return this.resolvedDbName;
        },

        /**
         * openDB
         * 
         * @returns {Promise<any>}
         */
        async openDB() {
            if (this.db) return this.db;
            const activeDbName = await this.resolveDbName();
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(activeDbName, 7); // 升级版本号
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    let historyStore;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        historyStore = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                    } else {
                        historyStore = request.transaction.objectStore(this.storeName);
                    }
                    if (!historyStore.indexNames.contains('timestamp')) {
                        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                    if (!historyStore.indexNames.contains('memoryIndex')) {
                        historyStore.createIndex('memoryIndex', 'memoryIndex', { unique: false });
                    }
                    if (!historyStore.indexNames.contains('memoryTitleFileHash')) {
                        historyStore.createIndex('memoryTitleFileHash', ['memoryTitle', 'fileHash'], { unique: false });
                    }
                    if (!db.objectStoreNames.contains(this.metaStoreName)) {
                        db.createObjectStore(this.metaStoreName, { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains(this.stateStoreName)) {
                        db.createObjectStore(this.stateStoreName, { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains(this.rollStoreName)) {
                        const rollStore = db.createObjectStore(this.rollStoreName, { keyPath: 'id', autoIncrement: true });
                        rollStore.createIndex('memoryIndex', 'memoryIndex', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(this.categoriesStoreName)) {
                        db.createObjectStore(this.categoriesStoreName, { keyPath: 'key' });
                    }
                    // 新增：条目级别Roll历史存储
                    if (!db.objectStoreNames.contains(this.entryRollStoreName)) {
                        const entryRollStore = db.createObjectStore(this.entryRollStoreName, { keyPath: 'id', autoIncrement: true });
                        entryRollStore.createIndex('entryKey', 'entryKey', { unique: false }); // category:entryName
                        entryRollStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                };
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve(this.db);
                };
                request.onerror = (event) => reject(event.target.error);
            });
        },

        /**
         * saveCustomCategories
         * 
         * @param {*} categories
         * @returns {Promise<any>}
         */
        async saveCustomCategories(categories) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.categoriesStoreName], 'readwrite');
                const store = transaction.objectStore(this.categoriesStoreName);
                const request = store.put({ key: 'customCategories', value: categories });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getCustomCategories
         * 
         * @returns {Promise<any>}
         */
        async getCustomCategories() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.categoriesStoreName], 'readonly');
                const store = transaction.objectStore(this.categoriesStoreName);
                const request = store.get('customCategories');
                request.onsuccess = () => resolve(request.result?.value || null);
                request.onerror = () => reject(request.error);
            });
        },

        buildHistoryDedupKey(memoryTitle) {
            return [memoryTitle, AppState.file.hash || null];
        },

        async getDuplicateHistoryRecords(memoryTitle) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                if (!store.indexNames.contains('memoryTitleFileHash')) {
                    const request = store.getAll();
                    request.onsuccess = () => {
                        const fileHash = AppState.file.hash || null;
                        resolve((request.result || []).filter(item => item.memoryTitle === memoryTitle && (item.fileHash || null) === fileHash));
                    };
                    request.onerror = () => reject(request.error);
                    return;
                }
                const index = store.index('memoryTitleFileHash');
                const request = index.getAll(this.buildHistoryDedupKey(memoryTitle));
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * saveHistory
         * 
         * @param {*} memoryIndex
         * @param {*} memoryTitle
         * @param {*} previousWorldbook
         * @param {*} newWorldbook
         * @param {*} changedEntries
         * @returns {Promise<any>}
         */
        async saveHistory(memoryIndex, memoryTitle, previousWorldbook, newWorldbook, changedEntries, options = {}) {
            const db = await this.openDB();
            const allowedDuplicates = ['记忆-优化', '记忆-演变总结'];
            if (!allowedDuplicates.includes(memoryTitle)) {
                try {
                    const duplicates = await this.getDuplicateHistoryRecords(memoryTitle);
                    if (duplicates.length > 0) {
                        const deleteTransaction = db.transaction([this.storeName], 'readwrite');
                        const deleteStore = deleteTransaction.objectStore(this.storeName);
                        for (const dup of duplicates) {
                            deleteStore.delete(dup.id);
                        }
                        await new Promise((resolve, reject) => {
                            deleteTransaction.oncomplete = () => resolve();
                            deleteTransaction.onerror = () => reject(deleteTransaction.error);
                        });
                    }
                } catch (error) {
                    Logger.error('MemoryHistoryDB', '删除重复历史记录失败:', error);
                }
            }
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const record = {
                    timestamp: Date.now(),
                    memoryIndex,
                    memoryTitle,
                    previousWorldbook: JSON.parse(JSON.stringify(previousWorldbook || {})),
                    newWorldbook: JSON.parse(JSON.stringify(newWorldbook || {})),
                    changedEntries: changedEntries || [],
                    snapshotMode: String(options?.snapshotMode || 'full'),
                    fileHash: AppState.file.hash || null,
                    volumeIndex: AppState.worldbook.currentVolumeIndex
                };
                const request = store.add(record);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getAllHistory
         * 
         * @returns {Promise<any>}
         */
        async getAllHistory() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getHistoryById
         * 
         * @param {*} id
         * @returns {Promise<any>}
         */
        async getHistoryById(id) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearAllHistory
         * 
         * @returns {Promise<any>}
         */
        async clearAllHistory() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearAllRolls
         * 
         * @returns {Promise<any>}
         */
        async clearAllRolls() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.rollStoreName], 'readwrite');
                const store = transaction.objectStore(this.rollStoreName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * saveFileHash
         * 
         * @param {*} hash
         * @returns {Promise<any>}
         */
        async saveFileHash(hash) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.metaStoreName], 'readwrite');
                const store = transaction.objectStore(this.metaStoreName);
                const request = store.put({ key: 'AppState.file.hash', value: hash });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getSavedFileHash
         * 
         * @returns {Promise<any>}
         */
        async getSavedFileHash() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.metaStoreName], 'readonly');
                const store = transaction.objectStore(this.metaStoreName);
                const request = store.get('AppState.file.hash');
                request.onsuccess = () => resolve(request.result?.value || null);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearFileHash
         * 
         * @returns {Promise<any>}
         */
        async clearFileHash() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.metaStoreName], 'readwrite');
                const store = transaction.objectStore(this.metaStoreName);
                const request = store.delete('AppState.file.hash');
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        buildStateSnapshot(processedIndex) {
            return {
                key: 'currentState',
                processedIndex,
                memoryQueue: JSON.parse(JSON.stringify(AppState.memory.queue)),
                generatedWorldbook: JSON.parse(JSON.stringify(AppState.worldbook.generated)),
                worldbookVolumes: JSON.parse(JSON.stringify(AppState.worldbook.volumes)),
                currentVolumeIndex: AppState.worldbook.currentVolumeIndex,
                fileHash: AppState.file.hash,
                novelName: AppState.file.novelName || '',
                experience: JSON.parse(JSON.stringify(AppState.experience || {})),
                processingState: {
                    incrementalMode: !!AppState.processing?.incrementalMode,
                    volumeMode: !!AppState.processing?.volumeMode,
                },
                queueState: {
                    startIndex: Number.isInteger(AppState.memory?.startIndex) ? AppState.memory.startIndex : 0,
                    userSelectedIndex: Number.isInteger(AppState.memory?.userSelectedIndex) ? AppState.memory.userSelectedIndex : null,
                },
                timestamp: Date.now(),
            };
        },

        async writeStateSnapshot(state) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stateStoreName], 'readwrite');
                const store = transaction.objectStore(this.stateStoreName);
                const request = store.put(state);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        scheduleStateSaveFlush() {
            if (this.stateSaveTimer) return;
            this.stateSaveTimer = setTimeout(() => {
                this.stateSaveTimer = null;
                this.flushPendingStateSave().catch((error) => {
                    Logger.error('MemoryHistoryDB', 'saveState 节流写入失败:', error);
                });
            }, this.stateSaveThrottleMs);
        },

        rejectPendingStateSave(error) {
            const rejectors = this.stateSavePendingRejectors.splice(0);
            this.stateSavePendingResolvers.length = 0;
            rejectors.forEach((reject) => {
                try {
                    reject(error);
                } catch (_) {}
            });
        },

        resolvePendingStateSave() {
            const resolvers = this.stateSavePendingResolvers.splice(0);
            this.stateSavePendingRejectors.length = 0;
            resolvers.forEach((resolve) => {
                try {
                    resolve();
                } catch (_) {}
            });
        },

        cancelPendingStateSave(error = null) {
            if (this.stateSaveTimer) {
                clearTimeout(this.stateSaveTimer);
                this.stateSaveTimer = null;
            }
            this.stateSavePendingState = null;
            if (error) {
                this.rejectPendingStateSave(error);
            } else {
                this.resolvePendingStateSave();
            }
        },

        async flushPendingStateSave() {
            if (this.stateSaveTimer) {
                clearTimeout(this.stateSaveTimer);
                this.stateSaveTimer = null;
            }

            if (this.stateSaveFlushPromise) {
                await this.stateSaveFlushPromise;
            }

            while (this.stateSavePendingState) {
                const state = this.stateSavePendingState;
                this.stateSavePendingState = null;
                this.stateSaveFlushPromise = this.writeStateSnapshot(state)
                    .then(() => {
                        this.resolvePendingStateSave();
                    })
                    .catch((error) => {
                        this.rejectPendingStateSave(error);
                        throw error;
                    })
                    .finally(() => {
                        this.stateSaveFlushPromise = null;
                    });
                await this.stateSaveFlushPromise;
            }
        },

        /**
         * saveState
         * 
         * @param {*} processedIndex
         * @returns {Promise<any>}
         */
        async saveState(processedIndex, options = {}) {
            const immediate = options && options.immediate === true;
            const state = this.buildStateSnapshot(processedIndex);
            this.stateSavePendingState = state;

            const waiter = new Promise((resolve, reject) => {
                this.stateSavePendingResolvers.push(resolve);
                this.stateSavePendingRejectors.push(reject);
            });

            if (immediate) {
                await this.flushPendingStateSave();
                return waiter;
            }

            this.scheduleStateSaveFlush();
            return waiter;
        },

        /**
         * loadState
         * 
         * @returns {Promise<any>}
         */
        async loadState() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stateStoreName], 'readonly');
                const store = transaction.objectStore(this.stateStoreName);
                const request = store.get('currentState');
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearState
         * 
         * @returns {Promise<any>}
         */
        async clearState() {
            this.cancelPendingStateSave();
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.stateStoreName], 'readwrite');
                const store = transaction.objectStore(this.stateStoreName);
                const request = store.delete('currentState');
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * saveRollResult
         * 
         * @param {*} memoryIndex
         * @param {*} result
         * @returns {Promise<any>}
         */
        async saveRollResult(memoryIndex, result) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.rollStoreName], 'readwrite');
                const store = transaction.objectStore(this.rollStoreName);
                const record = {
                    memoryIndex,
                    result: JSON.parse(JSON.stringify(result)),
                    timestamp: Date.now()
                };
                const request = store.add(record);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getRollResults
         * 
         * @param {*} memoryIndex
         * @returns {Promise<any>}
         */
        async getRollResults(memoryIndex) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.rollStoreName], 'readonly');
                const store = transaction.objectStore(this.rollStoreName);
                const index = store.index('memoryIndex');
                const request = index.getAll(memoryIndex);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearRollResults
         * 
         * @param {*} memoryIndex
         * @returns {Promise<any>}
         */
        async clearRollResults(memoryIndex) {
            const db = await this.openDB();
            const results = await this.getRollResults(memoryIndex);
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.rollStoreName], 'readwrite');
                const store = transaction.objectStore(this.rollStoreName);
                for (const r of results) {
                    store.delete(r.id);
                }
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        },

        // ========== 新增：条目级别Roll历史方法 ==========
        async saveEntryRollResult(category, entryName, memoryIndex, result, customPrompt = '') {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readwrite');
                const store = transaction.objectStore(this.entryRollStoreName);
                const entryKey = `${category}:${entryName}`;
                const record = {
                    entryKey,
                    category,
                    entryName,
                    memoryIndex,
                    result: JSON.parse(JSON.stringify(result)),
                    customPrompt,
                    timestamp: Date.now()
                };
                const request = store.add(record);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getEntryRollResults
         * 
         * @param {*} category
         * @param {*} entryName
         * @returns {Promise<any>}
         */
        async getEntryRollResults(category, entryName) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readonly');
                const store = transaction.objectStore(this.entryRollStoreName);
                const index = store.index('entryKey');
                const entryKey = `${category}:${entryName}`;
                const request = index.getAll(entryKey);
                request.onsuccess = () => {
                    const results = request.result || [];
                    // 按时间倒序排列
                    results.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(results);
                };
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * clearEntryRollResults
         * 
         * @param {*} category
         * @param {*} entryName
         * @returns {Promise<any>}
         */
        async clearEntryRollResults(category, entryName) {
            const db = await this.openDB();
            const results = await this.getEntryRollResults(category, entryName);
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readwrite');
                const store = transaction.objectStore(this.entryRollStoreName);
                for (const r of results) {
                    store.delete(r.id);
                }
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        },

        /**
         * clearAllEntryRolls
         * 
         * @returns {Promise<any>}
         */
        async clearAllEntryRolls() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readwrite');
                const store = transaction.objectStore(this.entryRollStoreName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * deleteEntryRollById
         * 
         * @param {*} rollId
         * @returns {Promise<any>}
         */
        async deleteEntryRollById(rollId) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readwrite');
                const store = transaction.objectStore(this.entryRollStoreName);
                const request = store.delete(rollId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * getEntryRollById
         * 
         * @param {*} rollId
         * @returns {Promise<any>}
         */
        async getEntryRollById(rollId) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.entryRollStoreName], 'readonly');
                const store = transaction.objectStore(this.entryRollStoreName);
                const request = store.get(rollId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * rollbackToHistory
         * 
         * @param {*} historyId
         * @returns {Promise<any>}
         */
        async rollbackToHistory(historyId) {
            const history = await this.getHistoryById(historyId);
            if (!history) throw new Error('找不到指定的历史记录');
            const allHistory = await this.getAllHistory();
            const toDelete = allHistory
                .filter(h => h.id >= historyId)
                .sort((a, b) => b.id - a.id);

            const canUseDirectSnapshot = history
                && history.snapshotMode !== 'delta'
                && history.previousWorldbook
                && typeof history.previousWorldbook === 'object';

            if (canUseDirectSnapshot) {
                AppState.worldbook.generated = JSON.parse(JSON.stringify(history.previousWorldbook));
            } else {
                const worldbook = JSON.parse(JSON.stringify(AppState.worldbook.generated || {}));
                for (const record of toDelete) {
                    const changes = Array.isArray(record.changedEntries) ? record.changedEntries : [];
                    for (const change of changes) {
                        const category = String(change?.category || '').trim();
                        const entryName = String(change?.entryName || '').trim();
                        if (!category || !entryName) continue;

                        if (!Object.prototype.hasOwnProperty.call(worldbook, category) || typeof worldbook[category] !== 'object' || !worldbook[category]) {
                            worldbook[category] = {};
                        }

                        const oldValue = change.oldValue;
                        if (oldValue === null || oldValue === undefined) {
                            delete worldbook[category][entryName];
                            if (Object.keys(worldbook[category]).length === 0) {
                                delete worldbook[category];
                            }
                            continue;
                        }

                        worldbook[category][entryName] = JSON.parse(JSON.stringify(oldValue));
                    }
                }
                AppState.worldbook.generated = worldbook;
            }

            const db = await this.openDB();
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            for (const h of toDelete) {
                store.delete(h.id);
            }
            return history;
        },

        /**
         * cleanDuplicateHistory
         * 
         * @returns {Promise<any>}
         */
        async cleanDuplicateHistory() {
            const db = await this.openDB();
            const allHistory = await this.getAllHistory();
            const allowedDuplicates = ['记忆-优化', '记忆-演变总结'];
            const groupedByTitle = {};
            for (const record of allHistory) {
                const title = record.memoryTitle;
                if (!groupedByTitle[title]) groupedByTitle[title] = [];
                groupedByTitle[title].push(record);
            }
            const toDelete = [];
            for (const title in groupedByTitle) {
                if (allowedDuplicates.includes(title)) continue;
                const records = groupedByTitle[title];
                if (records.length > 1) {
                    records.sort((a, b) => b.timestamp - a.timestamp);
                    toDelete.push(...records.slice(1));
                }
            }
            if (toDelete.length > 0) {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                for (const record of toDelete) {
                    store.delete(record.id);
                }
                await new Promise((resolve, reject) => {
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
                return toDelete.length;
            }
            return 0;
        }
    };
    return MemoryHistoryDB;
}
