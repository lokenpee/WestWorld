export function createChapterRegexView(deps = {}) {
    const {
        AppState,
        ModalFactory,
        ErrorHandler,
        Logger,
    } = deps;

    const INLINE_CHAPTER_MARKER_REGEX = /第\s*[零一二三四五六七八九十百千万两〇0-9]+\s*[章回卷节部篇]/giu;
    const INLINE_CHAPTER_BOUNDARY_CHAR_REGEX = /[。！？!?；;，,、”’」』）)\]】》〉]/u;

    function isLikelyChapterLineStart(content, index) {
        if (!Number.isInteger(index) || index < 0) return false;
        if (index === 0) return true;

        let cursor = index - 1;
        while (cursor >= 0) {
            const ch = content[cursor];
            if (ch === '\n' || ch === '\r') return true;
            if (!(/[\s\u3000\uFEFF]/.test(ch))) return false;
            cursor -= 1;
        }
        return true;
    }

    function getPreviousVisibleChar(content, index) {
        if (!Number.isInteger(index) || index <= 0) return '';

        let cursor = index - 1;
        while (cursor >= 0) {
            const ch = content[cursor];
            if (!(/[\s\u3000\uFEFF]/.test(ch))) return ch;
            cursor -= 1;
        }
        return '';
    }

    function isLikelyInlineChapterStart(content, index) {
        if (!Number.isInteger(index) || index < 0) return false;
        if (isLikelyChapterLineStart(content, index)) return true;

        const prevChar = getPreviousVisibleChar(content, index);
        return INLINE_CHAPTER_BOUNDARY_CHAR_REGEX.test(prevChar);
    }

    function normalizeInlineChapterMarkers(rawContent) {
        const content = typeof rawContent === 'string' ? rawContent : String(rawContent || '');
        if (!content) return content;

        let result = '';
        let cursor = 0;
        let changed = false;

        for (const match of content.matchAll(INLINE_CHAPTER_MARKER_REGEX)) {
            const index = Number.isInteger(match.index) ? match.index : -1;
            if (index < 0) continue;

            const marker = match[0];
            result += content.slice(cursor, index);

            const shouldInsertBreak = !isLikelyChapterLineStart(content, index)
                && isLikelyInlineChapterStart(content, index)
                && !result.endsWith('\n')
                && !result.endsWith('\r');

            if (shouldInsertBreak) {
                result += '\n';
                changed = true;
            }

            result += marker;
            cursor = index + marker.length;
        }

        if (cursor === 0) return content;
        result += content.slice(cursor);
        return changed ? result : content;
    }

    function extractChapterCapture(match) {
        if (!match || typeof match[0] !== 'string') {
            return { capturedText: '', offsetInFullMatch: 0 };
        }

        const fullMatch = match[0];
        for (let i = 1; i < match.length; i++) {
            const captured = typeof match[i] === 'string' ? match[i] : '';
            if (!captured) continue;

            const offset = fullMatch.indexOf(captured);
            if (offset >= 0) {
                return { capturedText: captured, offsetInFullMatch: offset };
            }
        }

        return { capturedText: fullMatch, offsetInFullMatch: 0 };
    }

    function getChapterMatchStartIndex(match) {
        const baseIndex = Number.isInteger(match?.index) ? match.index : 0;
        const capture = extractChapterCapture(match);
        return baseIndex + capture.offsetInFullMatch;
    }

    function getChapterMatchText(match) {
        return extractChapterCapture(match).capturedText || '';
    }

    function detectChaptersWithRegex(content, regexPattern) {
        try {
            const normalizedContent = normalizeInlineChapterMarkers(content);
            const regex = new RegExp(regexPattern, 'gm');
            const rawMatches = [...normalizedContent.matchAll(regex)];
            if (rawMatches.length === 0) return [];

            const lineStartMatches = rawMatches.filter((m) => {
                const matchStart = getChapterMatchStartIndex(m);
                return isLikelyInlineChapterStart(normalizedContent, matchStart);
            });

            return lineStartMatches.length > 0 ? lineStartMatches : rawMatches;
        } catch (e) {
            Logger.error('Regex', '正则表达式错误:', e);
            return [];
        }
    }

    function testChapterRegex() {
        if (!AppState.file.current && AppState.memory.queue.length === 0) {
            ErrorHandler.showUserError('请先上传文件');
            return;
        }

        const regexInput = document.getElementById('ttw-chapter-regex');
        const pattern = regexInput?.value || AppState.config.chapterRegex.pattern;

        const content = AppState.memory.queue.length > 0
            ? AppState.memory.queue.map((m) => m.content).join('')
            : '';
        if (!content) {
            ErrorHandler.showUserError('请先上传并加载文件');
            return;
        }

        const matches = detectChaptersWithRegex(content, pattern);

        if (matches.length === 0) {
            const modal = ModalFactory.create({
                id: 'ttw-regex-test-modal',
                title: '❌ 未检测到章节',
                body: `<div style="white-space: pre-wrap; padding: 10px;">当前正则: <code>${pattern}</code>\n\n建议:\n1. 尝试使用快速选择按钮\n2. 检查正则表达式是否正确</div>`,
                footer: '<button class="ttw-btn ttw-btn-primary" id="ttw-close-regex-test">关闭</button>',
            });
            modal.querySelector('#ttw-close-regex-test')
                .addEventListener('click', () => ModalFactory.close(modal));
            return;
        }

        const previewChapters = matches.slice(0, 10).map((m) => getChapterMatchText(m) || m[0]).join('\n');
        const modal = ModalFactory.create({
            id: 'ttw-regex-test-modal',
            title: `✅ 检测到 ${matches.length} 个章节`,
            body: `<div style="white-space: pre-wrap; padding: 10px; max-height: 400px; overflow-y: auto; background: rgba(0,0,0,0.3); color: #ccc; border-radius: 4px; border: 1px solid #555;">前10个章节预览:\n\n${previewChapters}${matches.length > 10 ? '\n...' : ''}</div>`,
            footer: '<button class="ttw-btn ttw-btn-primary" id="ttw-close-regex-test">关闭</button>',
        });
        modal.querySelector('#ttw-close-regex-test')
            .addEventListener('click', () => ModalFactory.close(modal));
    }

    return {
        testChapterRegex,
    };
}
