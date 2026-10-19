/**
 * Copy text from a user-triggered extension side-panel action.
 * Prefer the modern clipboard API, then fall back to a temporary textarea for Edge compatibility.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text.trim()) throw new Error('没有可复制的关键词');

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some extension/browser contexts reject the async API; try the user-gesture fallback below.
    }
  }

  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    throw new Error('当前环境不支持自动复制，请手动选择关键词复制');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }

  if (!copied) throw new Error('复制没有成功，请手动选择关键词复制');
}
