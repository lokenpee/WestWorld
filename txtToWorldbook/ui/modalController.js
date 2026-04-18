export function createModalController(deps) {
    const {
        AppState,
        setProcessingStatus,
        getGlobalSemaphore,
        getModalContainer,
        setModalContainer,
        removeEscListener,
        buildModalHtml,
        initializeModalState,
        restoreModalData,
        restoreExistingState,
        checkAndRestoreState,
        saveStateSnapshot,
        onRestoreStateError,
    } = deps;

    let exitPersistenceBound = false;
    let exitPersistenceHandler = null;
    const MODAL_SCROLL_STORAGE_KEY = 'westworldTxtToWorldbookModalScrollState';

    function getModalScrollContainer() {
        const container = getModalContainer();
        if (!container) return null;
        return container.querySelector('.ttw-modal-body');
    }

    function readSavedScrollTop() {
        if (Number.isFinite(Number(AppState?.ui?.lastModalScrollTop))) {
            return Math.max(0, Number(AppState.ui.lastModalScrollTop));
        }

        try {
            const raw = localStorage.getItem(MODAL_SCROLL_STORAGE_KEY);
            if (!raw) return 0;
            const parsed = JSON.parse(raw);
            const top = Number(parsed?.top);
            return Number.isFinite(top) ? Math.max(0, top) : 0;
        } catch (_) {
            return 0;
        }
    }

    function saveModalScrollPosition() {
        const scrollContainer = getModalScrollContainer();
        const top = Math.max(0, Number(scrollContainer?.scrollTop || 0));

        if (!AppState.ui || typeof AppState.ui !== 'object') {
            AppState.ui = {};
        }
        AppState.ui.lastModalScrollTop = top;

        try {
            localStorage.setItem(MODAL_SCROLL_STORAGE_KEY, JSON.stringify({
                top,
                at: Date.now(),
            }));
        } catch (_) {
            // ignore localStorage write errors
        }
    }

    function restoreModalScrollPosition() {
        const savedTop = readSavedScrollTop();
        if (!Number.isFinite(savedTop) || savedTop <= 0) return;

        const apply = () => {
            const scrollContainer = getModalScrollContainer();
            if (!scrollContainer) return;
            const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            scrollContainer.scrollTop = Math.min(savedTop, maxTop);
        };

        // 重复应用以覆盖异步内容渲染导致的滚动重置。
        apply();
        requestAnimationFrame(apply);
        requestAnimationFrame(() => requestAnimationFrame(apply));
    }

    function persistSnapshotOnExit() {
        saveModalScrollPosition();
        if (typeof saveStateSnapshot !== 'function') return;
        Promise.resolve(saveStateSnapshot()).catch(onRestoreStateError);
    }

    function ensureExitPersistenceBinding() {
        if (exitPersistenceBound) return;
        exitPersistenceHandler = () => persistSnapshotOnExit();
        window.addEventListener('pagehide', exitPersistenceHandler);
        window.addEventListener('beforeunload', exitPersistenceHandler);
        exitPersistenceBound = true;
    }

    async function createModal() {
        const previousContainer = getModalContainer();
        if (previousContainer) previousContainer.remove();

        const modalContainer = document.createElement('div');
        modalContainer.id = 'txt-to-worldbook-modal';
        modalContainer.className = 'ttw-modal-container';
        modalContainer.innerHTML = buildModalHtml();
        document.body.appendChild(modalContainer);
        setModalContainer(modalContainer);

        initializeModalState();
        restoreModalData();
        await restoreExistingState().catch(onRestoreStateError);

        // Auto-restore persisted snapshot for page refresh/browser reopen scenarios.
        if (AppState.memory.queue.length <= 0 && typeof checkAndRestoreState === 'function') {
            await checkAndRestoreState({ autoRestore: true }).catch(onRestoreStateError);
        }

        restoreModalScrollPosition();

        ensureExitPersistenceBinding();
    }

    function handleEscKey(e) {
        if (e.key !== 'Escape') return;

        // 误触保护：ESC只关闭子模态框（世界书预览、历史记录等），不关闭主UI
        const subModals = document.querySelectorAll('.ttw-modal-container:not(#txt-to-worldbook-modal)');
        if (subModals.length <= 0) return;

        const topModal = subModals[subModals.length - 1];
        if (topModal?.dataset?.ttwAllowGlobalEscClose === 'false') {
            e.stopPropagation();
            e.preventDefault();
            return;
        }

        e.stopPropagation();
        e.preventDefault();
        topModal.remove(); // 关闭最顶层的子模态框
        // 主模态框不响应ESC，只能通过右上角关闭按钮退出
    }

    function closeModal() {
        persistSnapshotOnExit();
        setProcessingStatus('stopped');

        const globalSemaphore = getGlobalSemaphore();
        if (globalSemaphore) globalSemaphore.abort();

        AppState.processing.activeTasks.clear();
        AppState.memory.queue.forEach(memory => {
            if (memory.processing) memory.processing = false;
        });

        const modalContainer = getModalContainer();
        if (modalContainer) {
            modalContainer.remove();
            setModalContainer(null);
        }

        removeEscListener(handleEscKey);
    }

    function open() {
        createModal();
    }

    return {
        createModal,
        handleEscKey,
        closeModal,
        open,
    };
}
