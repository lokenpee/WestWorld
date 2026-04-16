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

    function persistSnapshotOnExit() {
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

        ensureExitPersistenceBinding();
    }

    function handleEscKey(e) {
        if (e.key !== 'Escape') return;

        // 误触保护：ESC只关闭子模态框（世界书预览、历史记录等），不关闭主UI
        const subModals = document.querySelectorAll('.ttw-modal-container:not(#txt-to-worldbook-modal)');
        if (subModals.length <= 0) return;

        e.stopPropagation();
        e.preventDefault();
        subModals[subModals.length - 1].remove(); // 关闭最顶层的子模态框
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
