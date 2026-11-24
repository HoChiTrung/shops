/**
 * Mobile & In-App Browser (iOS Safari, Android Chrome, Facebook/Instagram WebView)
 * resilient clipboard copy helper.
 *
 * Strategy:
 * 1. Try modern navigator.clipboard.writeText when in a secure context.
 * 2. Fallback to an off-screen editable textarea + setSelectionRange(0, 99999) + execCommand('copy'),
 *    which succeeds reliably in iOS WebViews and embedded browsers where async clipboard API is restricted.
 */
export async function copyTextReliably(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy execCommand path
    }
  }

  return copyTextSyncFallback(text);
}

export function copyTextSyncFallback(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.fontSize = '16px'; // prevents iOS auto-zoom
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    const prevSelection = document.getSelection();
    const savedRanges: Range[] = [];
    if (prevSelection) {
      for (let i = 0; i < prevSelection.rangeCount; i++) {
        savedRanges.push(prevSelection.getRangeAt(i));
      }
    }

    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (prevSelection && savedRanges.length > 0) {
      prevSelection.removeAllRanges();
      savedRanges.forEach((range) => prevSelection.addRange(range));
    }

    return ok;
  } catch {
    return false;
  }
}
