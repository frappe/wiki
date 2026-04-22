// Initialize syntax highlighting and code block enhancements
function initCodeBlocks() {
    // First run syntax highlighting
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }

    // Then enhance code blocks with copy button and language badge
    document.querySelectorAll('pre code.hljs').forEach(function(codeBlock) {
        const pre = codeBlock.parentElement;

        // Skip if already processed
        if (pre.classList.contains('code-block-enhanced')) return;
        pre.classList.add('code-block-enhanced');

        // Strip trailing whitespace so it doesn't render as empty rows.
        const lastChild = codeBlock.lastChild;
        if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
            lastChild.nodeValue = lastChild.nodeValue.replace(/\s+$/, '\n');
        }

        // Get language from hljs class
        const classes = codeBlock.className.split(' ');
        let language = '';
        for (const cls of classes) {
            if (cls.startsWith('language-')) {
                language = cls.replace('language-', '');
                break;
            }
        }

        // Create toolbar element (positioned inside pre)
        const toolbar = document.createElement('div');
        toolbar.className = 'code-block-toolbar';

        // Copy button (appears on hover)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-block-copy';
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
        copyBtn.title = 'Copy code';
        copyBtn.addEventListener('click', function() {
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(function() {
                copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
                copyBtn.classList.add('copied');
                setTimeout(function() {
                    copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        });
        toolbar.appendChild(copyBtn);

        // Language badge (only if language is defined)
        if (language && language !== 'plaintext') {
            const langBadge = document.createElement('span');
            langBadge.className = 'code-block-lang';
            langBadge.textContent = language;
            toolbar.appendChild(langBadge);
        }

        // Insert toolbar inside pre element
        pre.appendChild(toolbar);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initCodeBlocks);

// Expose globally for SPA navigation
window.initCodeBlocks = initCodeBlocks;
