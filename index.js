import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { initTxtToWorldbookBridge, getTxtToWorldbookApi } from './txtToWorldbook/main.js';

const extensionName = 'storyweaver';
const setupEventNamespace = '.storyweaver';

const defaultSettings = {
    panelCollapsed: true,
};

let settings = {};

function getExtensionFolderName() {
    const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(import.meta.url);
    return match?.[1] ? decodeURIComponent(match[1]) : 'StoryWeaver';
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountDrawerHtml(html) {
    const existingWrapper = document.getElementById('storyweaver-wrapper');

    const topbarAnchor = $('#extensions-settings-button');
    if (topbarAnchor.length > 0) {
        if (existingWrapper) {
            topbarAnchor.after(existingWrapper);
        } else {
            topbarAnchor.after(html);
        }
        return true;
    }

    const settingsPanel = $('#extensions_settings2');
    if (settingsPanel.length > 0) {
        if (existingWrapper) {
            settingsPanel.append(existingWrapper);
        } else {
            settingsPanel.append(html);
        }
        return true;
    }

    return false;
}

async function mountDrawerWithRetry(html, maxAttempts = 30, intervalMs = 200) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (mountDrawerHtml(html)) {
            return true;
        }
        await delay(intervalMs);
    }
    return false;
}

function ensureSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    settings = {
        ...defaultSettings,
        ...extension_settings[extensionName],
    };
    extension_settings[extensionName] = settings;
}

function persistSettings() {
    extension_settings[extensionName] = settings;
    saveSettingsDebounced();
}

function updateDrawerUI() {
    const iconEl = document.getElementById('storyweaver-icon');
    const panelEl = document.getElementById('storyweaver-content-panel');
    if (!iconEl || !panelEl) return;

    if (settings.panelCollapsed) {
        iconEl.classList.remove('openIcon');
        iconEl.classList.add('closedIcon');
        panelEl.classList.remove('openDrawer');
        panelEl.classList.add('closedDrawer');
    } else {
        iconEl.classList.remove('closedIcon');
        iconEl.classList.add('openIcon');
        panelEl.classList.remove('closedDrawer');
        panelEl.classList.add('openDrawer');
    }
}

function toggleDrawer() {
    settings.panelCollapsed = !settings.panelCollapsed;
    persistSettings();
    updateDrawerUI();
}

function openTxtToWorldbookPanel() {
    const api = getTxtToWorldbookApi();
    if (!api || typeof api.open !== 'function') {
        toastr.error('StoryWeaver converter is not ready yet.');
        return;
    }
    api.open();
}

async function setupUI() {
    const extensionFolder = getExtensionFolderName();

    // Load template using detected folder first, then fallback to the canonical name.
    let html = '';
    try {
        html = await renderExtensionTemplateAsync(`third-party/${extensionFolder}`, 'drawer-component');
    } catch (error) {
        if (extensionFolder !== 'StoryWeaver') {
            html = await renderExtensionTemplateAsync('third-party/StoryWeaver', 'drawer-component');
        } else {
            throw error;
        }
    }

    if (!html || !String(html).trim()) {
        throw new Error('StoryWeaver drawer template is empty.');
    }

    const mounted = await mountDrawerWithRetry(html);
    if (!mounted) {
        throw new Error('StoryWeaver mount target not found (#extensions-settings-button / #extensions_settings2).');
    }

    // Rebind with namespace to avoid duplicated handlers on reload.
    $(document).off(`click${setupEventNamespace}`, '#storyweaver-wrapper .drawer-toggle');
    $(document).on(`click${setupEventNamespace}`, '#storyweaver-wrapper .drawer-toggle', (e) => {
        e.stopPropagation();
        toggleDrawer();
    });

    $(document).off(`click${setupEventNamespace}`, '#storyweaver-open-converter');
    $(document).on(`click${setupEventNamespace}`, '#storyweaver-open-converter', () => {
        openTxtToWorldbookPanel();
    });

    $(document).off(`click${setupEventNamespace}`);
    $(document).on(`click${setupEventNamespace}`, (e) => {
        if (!settings.panelCollapsed) {
            const wrapper = document.getElementById('storyweaver-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                settings.panelCollapsed = true;
                persistSettings();
                updateDrawerUI();
            }
        }
    });

    // 初始化 UI 状态
    updateDrawerUI();
}

async function bootstrap() {
    ensureSettings();
    try {
        await setupUI();
    } catch (error) {
        console.error('[StoryWeaver] UI mount failed:', error);
        toastr.error('StoryWeaver UI mount failed. Please reload extensions.');
        return;
    }

    try {
        await initTxtToWorldbookBridge();
        window.StoryWeaver = {
            openTxtConverter: openTxtToWorldbookPanel,
            getTxtToWorldbookApi,
        };
        console.log('[StoryWeaver] Plugin initialized successfully');
    } catch (error) {
        console.error('[StoryWeaver] txtToWorldbook init failed:', error);
        toastr.error('StoryWeaver failed to initialize TXT converter.');
    }
}

jQuery(() => {
    bootstrap();
});
