// Initialize syntax highlighting and code block enhancements
function initCodeBlocks() {
    // Record the authored language before highlight.js auto-detection adds its
    // own language-* class, so the label mirrors the editor ("auto" when unset).
    document.querySelectorAll('pre > code').forEach(function(codeBlock) {
        if (codeBlock.dataset.language !== undefined) return;
        const match = codeBlock.className.match(/language-(\S+)/);
        codeBlock.dataset.language = match ? match[1] : '';
    });

    // First run syntax highlighting
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }

    // Then enhance code blocks to match the editor's code block node view:
    // line-number gutter + hover-revealed toolbar (language label, copy button)
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

        // Line-number gutter (one number per line, like the editor)
        const lineCount = codeBlock.textContent.replace(/\n$/, '').split('\n').length;
        const gutter = document.createElement('span');
        gutter.className = 'code-block-gutter';
        gutter.setAttribute('aria-hidden', 'true');
        for (let n = 1; n <= lineCount; n++) {
            const line = document.createElement('span');
            line.textContent = n;
            gutter.appendChild(line);
        }
        pre.insertBefore(gutter, codeBlock);

        // Toolbar (positioned top-right inside pre, revealed on hover)
        const toolbar = document.createElement('div');
        toolbar.className = 'code-block-toolbar';

        // Language label ("auto" when the block has no explicit language)
        const langLabel = document.createElement('span');
        langLabel.className = 'code-block-lang';
        langLabel.textContent = codeBlock.dataset.language || 'auto';
        toolbar.appendChild(langLabel);

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-block-copy';
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
        copyBtn.title = 'Copy code';
        copyBtn.addEventListener('click', function() {
            const code = codeBlock.textContent;
            navigator.clipboard.writeText(code).then(function() {
                copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
                setTimeout(function() {
                    copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
                }, 2000);
            });
        });
        toolbar.appendChild(copyBtn);

        // Insert toolbar inside pre element
        pre.appendChild(toolbar);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initCodeBlocks);

// Expose globally for SPA navigation
window.initCodeBlocks = initCodeBlocks;
