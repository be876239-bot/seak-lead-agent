import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from '../../src/ui/clipboard';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
  document.body.innerHTML = '';
});

describe('copyTextToClipboard', () => {
  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await copyTextToClipboard('AI PPT');

    expect(writeText).toHaveBeenCalledWith('AI PPT');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to a temporary textarea when the clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await copyTextToClipboard('AI PPT');

    expect(writeText).toHaveBeenCalledWith('AI PPT');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a clear error if both copy paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await expect(copyTextToClipboard('AI PPT')).rejects.toThrow('复制没有成功');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('rejects an empty suggestion without touching the clipboard', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await expect(copyTextToClipboard('   ')).rejects.toThrow('没有可复制的关键词');
    expect(writeText).not.toHaveBeenCalled();
  });
});
