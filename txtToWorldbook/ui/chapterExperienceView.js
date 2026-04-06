export function createChapterExperienceView(deps = {}) {
    const {
        AppState,
        ErrorHandler,
        callAPI,
        getLanguagePrefix,
        retryChapterOutline,
    } = deps;

    const selectors = {
        outlineSection: 'ttw-story-outline-section',
        currentSection: 'ttw-current-chapter-section',
        outlineList: 'ttw-story-outline-list',
        currentTitle: 'ttw-current-chapter-title',
        currentSummary: 'ttw-current-story-summary',
        currentScript: 'ttw-current-script',
        currentOpening: 'ttw-current-opening',
        chapterHint: 'ttw-current-chapter-hint',
        nextButton: 'ttw-next-chapter-btn',
        startFirstButton: 'ttw-start-reading-first',
    };

    function ensureState() {
        if (!AppState.experience) {
            AppState.experience = { currentChapterIndex: 0 };
        }
    }

    function getMemory(index) {
        return AppState.memory.queue[index] || null;
    }

    function ensureMemoryRuntime(memory, index) {
        if (!memory) return;
        if (!memory.chapterTitle || !String(memory.chapterTitle).trim()) {
            memory.chapterTitle = `第${index + 1}章`;
        }
        if (typeof memory.chapterOutline !== 'string') {
            memory.chapterOutline = '';
        }
        if (!memory.chapterOutlineStatus) {
            memory.chapterOutlineStatus = 'pending';
        }
        if (typeof memory.chapterOutlineError !== 'string') {
            memory.chapterOutlineError = '';
        }
        if (!memory.chapterScript || typeof memory.chapterScript !== 'object') {
            memory.chapterScript = { goal: '', flow: '', keyNodes: [] };
        }
        if (!Array.isArray(memory.chapterScript.keyNodes)) {
            memory.chapterScript.keyNodes = [];
        }
        if (typeof memory.chapterOpeningPreview !== 'string') {
            memory.chapterOpeningPreview = '';
        }
        if (typeof memory.chapterOpeningSent !== 'boolean') {
            memory.chapterOpeningSent = false;
        }
        if (typeof memory.chapterOpeningError !== 'string') {
            memory.chapterOpeningError = '';
        }
        if (typeof memory.chapterOpeningGenerating !== 'boolean') {
            memory.chapterOpeningGenerating = false;
        }
    }

    function toShortText(text, maxLen = 180) {
        const plain = String(text || '').replace(/\s+/g, ' ').trim();
        if (!plain) return '';
        return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
    }

    function deriveOutlineFromContent(memory) {
        const raw = toShortText(memory.content || '', 140);
        if (!raw) return `${memory.chapterTitle}剧情推进。`;
        const firstSentence = raw.split(/[。！？!?]/).map((s) => s.trim()).filter(Boolean).slice(0, 2).join('，');
        return firstSentence || raw;
    }

    function deriveScriptFromOutline(outline) {
        const text = toShortText(outline, 160);
        const nodes = text
            .split(/[，,。]/)
            .map((node) => node.trim())
            .filter(Boolean)
            .slice(0, 3);

        return {
            goal: '围绕本章关键冲突推进叙事并保持角色动机一致。',
            flow: text || '本章推进关键事件并承接上章内容。',
            keyNodes: nodes,
        };
    }

    function statusTag(status) {
        if (status === 'done') return '<span class="ttw-outline-status ttw-outline-status-done">已生成</span>';
        if (status === 'generating') return '<span class="ttw-outline-status ttw-outline-status-generating">生成中</span>';
        if (status === 'failed') return '<span class="ttw-outline-status ttw-outline-status-failed">生成失败</span>';
        return '<span class="ttw-outline-status ttw-outline-status-pending">待生成</span>';
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setSectionVisibility({ showOutline = false, showCurrent = false }) {
        const outlineSection = document.getElementById(selectors.outlineSection);
        const currentSection = document.getElementById(selectors.currentSection);
        if (outlineSection) outlineSection.style.display = showOutline ? 'block' : 'none';
        if (currentSection) currentSection.style.display = showCurrent ? 'block' : 'none';
    }

    function renderOutlineList() {
        const listEl = document.getElementById(selectors.outlineList);
        if (!listEl) return;

        if (AppState.memory.queue.length === 0) {
            listEl.innerHTML = '<div class="ttw-outline-empty">暂无章节数据，请先导入并完成处理。</div>';
            return;
        }

        const html = AppState.memory.queue.map((memory, index) => {
            ensureMemoryRuntime(memory, index);
            const title = memory.chapterTitle || `第${index + 1}章`;
            const outline = memory.chapterOutline || '';
            const outlineText = outline || (memory.chapterOutlineStatus === 'failed' ? '该章大纲生成失败，请点击重试。' : '该章尚未生成大纲。');
            const canRetry = memory.chapterOutlineStatus === 'failed';

            return `
<div class="ttw-outline-item" data-index="${index}">
    <button class="ttw-outline-toggle" data-action="toggle" data-index="${index}">
        <span class="ttw-outline-title">${escapeHtml(title)}</span>
        ${statusTag(memory.chapterOutlineStatus)}
    </button>
    <div class="ttw-outline-body" id="ttw-outline-body-${index}" style="display:none;">
        <div class="ttw-outline-summary">${escapeHtml(outlineText)}</div>
        ${canRetry ? `<button class="ttw-btn ttw-btn-small" data-action="retry-outline" data-index="${index}">🔁 重试本章大纲</button>` : ''}
        <button class="ttw-btn ttw-btn-small" data-action="view-chapter" data-index="${index}">📖 查看当前章节概览</button>
    </div>
</div>`;
        }).join('');

        listEl.innerHTML = html;
    }

    function buildScriptHtml(memory) {
        const script = memory.chapterScript && typeof memory.chapterScript === 'object'
            ? memory.chapterScript
            : deriveScriptFromOutline(memory.chapterOutline);

        const goal = toShortText(script.goal, 140) || '围绕本章核心冲突推进剧情。';
        const flow = toShortText(script.flow, 220) || (memory.chapterOutline || '本章沿主线推进。');
        const keyNodes = Array.isArray(script.keyNodes)
            ? script.keyNodes.map((node) => toShortText(node, 60)).filter(Boolean)
            : [];

        const nodesHtml = keyNodes.length > 0
            ? `<ul>${keyNodes.map((node) => `<li>${escapeHtml(node)}</li>`).join('')}</ul>`
            : '<div class="ttw-script-empty">暂无关键节点，将按摘要推进。</div>';

        return `
<div class="ttw-script-block">
    <div class="ttw-script-field"><strong>目标：</strong>${escapeHtml(goal)}</div>
    <div class="ttw-script-field"><strong>流程：</strong>${escapeHtml(flow)}</div>
    <div class="ttw-script-field"><strong>关键节点：</strong>${nodesHtml}</div>
</div>`;
    }

    function renderCurrentPanel() {
        ensureState();
        const idx = Math.max(0, Math.min(AppState.experience.currentChapterIndex || 0, Math.max(0, AppState.memory.queue.length - 1)));
        AppState.experience.currentChapterIndex = idx;

        const memory = getMemory(idx);
        const titleEl = document.getElementById(selectors.currentTitle);
        const summaryEl = document.getElementById(selectors.currentSummary);
        const scriptEl = document.getElementById(selectors.currentScript);
        const openingEl = document.getElementById(selectors.currentOpening);
        const hintEl = document.getElementById(selectors.chapterHint);
        const nextBtn = document.getElementById(selectors.nextButton);

        if (!memory) {
            if (titleEl) titleEl.textContent = '当前章节概览';
            if (summaryEl) summaryEl.textContent = '暂无章节数据';
            if (scriptEl) scriptEl.innerHTML = '<div class="ttw-script-empty">暂无剧本数据</div>';
            if (openingEl) openingEl.textContent = '暂无开场白';
            if (hintEl) hintEl.textContent = '请先完成TXT处理。';
            if (nextBtn) nextBtn.disabled = true;
            return;
        }

        ensureMemoryRuntime(memory, idx);

        const title = memory.chapterTitle || `第${idx + 1}章`;
        const outline = memory.chapterOutline || deriveOutlineFromContent(memory);
        if (!memory.chapterOutline) {
            memory.chapterOutline = outline;
        }

        if (titleEl) titleEl.textContent = title;
        if (summaryEl) summaryEl.textContent = outline;
        if (scriptEl) scriptEl.innerHTML = buildScriptHtml(memory);

        if (memory.chapterOpeningGenerating) {
            if (openingEl) openingEl.textContent = '正在生成开场白...';
        } else if (memory.chapterOpeningPreview) {
            if (openingEl) openingEl.textContent = memory.chapterOpeningPreview;
        } else if (memory.chapterOpeningError) {
            if (openingEl) openingEl.textContent = `开场白生成失败：${memory.chapterOpeningError}`;
        } else {
            if (openingEl) openingEl.textContent = '进入本章后将自动生成并发送开场白。';
        }

        const isLast = idx >= AppState.memory.queue.length - 1;
        if (nextBtn) {
            nextBtn.disabled = isLast;
            nextBtn.textContent = isLast ? '⏹ 已是最后一章' : '⏭ 下一章';
        }
        if (hintEl) {
            hintEl.textContent = isLast ? '当前已到最后一章。' : '点击“下一章”将立即自动发送下一章开场白。';
        }
    }

    function collectRecentDialogueContext() {
        try {
            const st = typeof SillyTavern !== 'undefined' ? SillyTavern : null;
            if (!st || typeof st.getContext !== 'function') return '';
            const context = st.getContext();
            const chat = Array.isArray(context?.chat) ? context.chat : [];
            if (chat.length === 0) return '';

            let lastUser = null;
            let lastAssistant = null;
            for (let i = chat.length - 1; i >= 0; i--) {
                const item = chat[i];
                const text = String(item?.mes || '').trim();
                if (!text) continue;
                if (!lastUser && item?.is_user) {
                    lastUser = text;
                    continue;
                }
                if (lastUser && !item?.is_user) {
                    lastAssistant = text;
                    break;
                }
            }

            if (lastUser && lastAssistant) {
                return `上一轮完整对话：\nAI：${toShortText(lastAssistant, 350)}\n玩家：${toShortText(lastUser, 350)}`;
            }
            if (lastUser) {
                return `上一轮玩家输入：\n玩家：${toShortText(lastUser, 350)}`;
            }
            return '';
        } catch (_) {
            return '';
        }
    }

    function buildOpeningFallback(memory, index) {
        const outline = memory.chapterOutline || deriveOutlineFromContent(memory);
        const title = memory.chapterTitle || `第${index + 1}章`;
        const text = toShortText(outline, 180);
        return `${title}，故事继续。${text}`;
    }

    function sanitizeOpeningText(raw, memory, index) {
        const text = String(raw || '')
            .replace(/^```[a-z]*\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        if (!text) {
            return buildOpeningFallback(memory, index);
        }
        return text;
    }

    async function generateOpeningText(memory, index) {
        const chapterTitle = memory.chapterTitle || `第${index + 1}章`;
        const chapterOutline = memory.chapterOutline || deriveOutlineFromContent(memory);
        const script = memory.chapterScript && typeof memory.chapterScript === 'object'
            ? memory.chapterScript
            : deriveScriptFromOutline(chapterOutline);

        const prevTitle = index > 0 ? (AppState.memory.queue[index - 1]?.chapterTitle || `第${index}章`) : '';
        const dialogueContext = index > 0 ? collectRecentDialogueContext() : '';

        const prompt = `${getLanguagePrefix()}你是互动小说旁白。请生成本章开场白。\n\n要求：\n1) 输出 120-220 字中文。\n2) 文风自然沉浸，不要解释规则，不要输出JSON。\n3) 只聚焦当前章节，不剧透后续。\n4) 除第一章外，需要自然承接上一轮对话。\n\n当前章节：${chapterTitle}\n本章摘要：${chapterOutline}\n本章目标：${script.goal || ''}\n本章流程：${script.flow || ''}\n关键节点：${(script.keyNodes || []).join('、')}\n${prevTitle ? `上一章：${prevTitle}` : ''}\n${dialogueContext || ''}`;

        const response = await callAPI(prompt, index + 1);
        return sanitizeOpeningText(response, memory, index);
    }

    async function pushOpeningMessage(text, index) {
        const st = typeof SillyTavern !== 'undefined' ? SillyTavern : null;
        if (!st || typeof st.getContext !== 'function') {
            throw new Error('无法访问SillyTavern上下文');
        }

        const context = st.getContext();
        if (!context || !Array.isArray(context.chat)) {
            throw new Error('当前聊天上下文不可用');
        }

        const openingMessage = {
            is_user: false,
            mes: text,
            _storyweaver_auto_opening: true,
            _storyweaver_chapter: index + 1,
            _generatedAt: Date.now(),
        };

        if (typeof context.addOneMessage === 'function') {
            await context.addOneMessage(openingMessage);
            return;
        }

        context.chat.push(openingMessage);

        if (typeof context.saveChat === 'function') {
            await context.saveChat();
        }
        if (typeof context.reloadCurrentChat === 'function') {
            await context.reloadCurrentChat();
        } else if (typeof context.renderChat === 'function') {
            context.renderChat();
        }
    }

    async function ensureOpeningForChapter(index) {
        const memory = getMemory(index);
        if (!memory) return;
        ensureMemoryRuntime(memory, index);
        if (memory.chapterOpeningSent || memory.chapterOpeningGenerating) {
            return;
        }

        memory.chapterOpeningGenerating = true;
        memory.chapterOpeningError = '';
        renderCurrentPanel();

        try {
            const opening = await generateOpeningText(memory, index);
            memory.chapterOpeningPreview = opening;

            try {
                await pushOpeningMessage(opening, index);
                memory.chapterOpeningSent = true;
            } catch (sendError) {
                memory.chapterOpeningSent = false;
                memory.chapterOpeningError = String(sendError?.message || '发送失败');
                ErrorHandler.showUserError(`开场白发送失败：${memory.chapterOpeningError}`);
            }
        } catch (error) {
            const fallback = buildOpeningFallback(memory, index);
            memory.chapterOpeningPreview = fallback;
            try {
                await pushOpeningMessage(fallback, index);
                memory.chapterOpeningSent = true;
                memory.chapterOpeningError = '开场白生成失败，已使用摘要降级发送。';
            } catch (sendError) {
                memory.chapterOpeningSent = false;
                memory.chapterOpeningError = String(sendError?.message || error?.message || '开场白生成失败');
                ErrorHandler.showUserError(`开场白生成失败：${memory.chapterOpeningError}`);
            }
        } finally {
            memory.chapterOpeningGenerating = false;
            renderCurrentPanel();
        }
    }

    async function enterChapter(index) {
        if (index < 0 || index >= AppState.memory.queue.length) return;
        ensureState();
        AppState.experience.currentChapterIndex = index;
        renderCurrentPanel();
        await ensureOpeningForChapter(index);
    }

    async function showCurrentChapterPanel() {
        setSectionVisibility({ showOutline: false, showCurrent: true });
        renderCurrentPanel();
        ensureState();
        await ensureOpeningForChapter(AppState.experience.currentChapterIndex || 0);
    }

    function showStoryOutlinePanel() {
        setSectionVisibility({ showOutline: true, showCurrent: false });
        renderOutlineList();
    }

    async function handleOutlineAction(action, index) {
        if (action === 'toggle') {
            const body = document.getElementById(`ttw-outline-body-${index}`);
            if (body) {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
            }
            return;
        }

        if (action === 'retry-outline') {
            try {
                await retryChapterOutline(index);
                ErrorHandler.showUserSuccess(`第${index + 1}章大纲重试成功`);
            } catch (error) {
                ErrorHandler.showUserError(`第${index + 1}章大纲重试失败：${error.message}`);
            }
            renderOutlineList();
            return;
        }

        if (action === 'view-chapter') {
            await enterChapter(index);
            setSectionVisibility({ showOutline: false, showCurrent: true });
            return;
        }
    }

    function bindOutlineEvents() {
        const listEl = document.getElementById(selectors.outlineList);
        if (listEl && !listEl.dataset.bound) {
            listEl.dataset.bound = '1';
            listEl.addEventListener('click', async (event) => {
                const target = event.target.closest('[data-action]');
                if (!target) return;
                const action = target.getAttribute('data-action');
                const index = parseInt(target.getAttribute('data-index') || '-1', 10);
                if (Number.isNaN(index) || index < 0) return;
                await handleOutlineAction(action, index);
            });
        }

        const startBtn = document.getElementById(selectors.startFirstButton);
        if (startBtn && !startBtn.dataset.bound) {
            startBtn.dataset.bound = '1';
            startBtn.addEventListener('click', async () => {
                await enterChapter(0);
                setSectionVisibility({ showOutline: false, showCurrent: true });
            });
        }
    }

    function bindCurrentEvents() {
        const nextBtn = document.getElementById(selectors.nextButton);
        if (nextBtn && !nextBtn.dataset.bound) {
            nextBtn.dataset.bound = '1';
            nextBtn.addEventListener('click', async () => {
                ensureState();
                const nextIndex = (AppState.experience.currentChapterIndex || 0) + 1;
                if (nextIndex >= AppState.memory.queue.length) {
                    ErrorHandler.showUserError('已是最后一章');
                    return;
                }
                await enterChapter(nextIndex);
            });
        }
    }

    function preparePanels() {
        bindOutlineEvents();
        bindCurrentEvents();
    }

    return {
        showStoryOutlinePanel: () => {
            preparePanels();
            showStoryOutlinePanel();
        },
        showCurrentChapterPanel: async () => {
            preparePanels();
            await showCurrentChapterPanel();
        },
        renderStoryOutline: () => {
            preparePanels();
            renderOutlineList();
        },
        renderCurrentChapter: () => {
            preparePanels();
            renderCurrentPanel();
        },
    };
}
