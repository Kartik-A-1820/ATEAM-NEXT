import {existsSync, mkdtempSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runProcess} from '../process/runner.js';

export interface ClipboardImageResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

interface CommandSpec {
  executable: string;
  args: string[];
}

/**
 * Captures whatever image is currently on the OS clipboard and saves it to a
 * temp PNG file. There's no way to receive raw image bytes over a plain TTY
 * paste, so this shells out to a platform clipboard tool instead — triggered
 * explicitly (e.g. a /paste-image command), not on every keystroke.
 */
export async function captureClipboardImage(platform: NodeJS.Platform = process.platform): Promise<ClipboardImageResult> {
  const spec = commandForPlatform(platform);
  if (!spec) {
    return {ok: false, reason: `Clipboard image capture isn't supported on ${platform} yet.`};
  }
  const dir = mkdtempSync(join(tmpdir(), 'ateam-paste-'));
  const filePath = join(dir, `${randomUUID()}.png`);
  const args = spec.args.map(arg => arg.replaceAll('{{path}}', filePath));

  let result;
  try {
    result = await runProcess({executable: spec.executable, args, cwd: dir, timeoutMs: 8000});
  } catch (error) {
    return {ok: false, reason: error instanceof Error ? error.message : String(error)};
  }
  if (result.exitCode !== 0 || !existsSync(filePath) || statSync(filePath).size === 0) {
    return {ok: false, reason: result.stderr.trim() || 'No image found on the clipboard.'};
  }
  return {ok: true, path: filePath};
}

export function commandForPlatform(platform: NodeJS.Platform): CommandSpec | undefined {
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      'Add-Type -AssemblyName System.Drawing;',
      '$img = [System.Windows.Forms.Clipboard]::GetImage();',
      'if ($img -eq $null) { exit 1 }',
      '$img.Save(\'{{path}}\', [System.Drawing.Imaging.ImageFormat]::Png)',
    ].join(' ');
    return {executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script]};
  }
  if (platform === 'darwin') {
    const script = [
      'try',
      '  set imgData to the clipboard as «class PNGf»',
      'on error',
      '  return 1',
      'end try',
      'set f to open for access POSIX file "{{path}}" with write permission',
      'write imgData to f',
      'close access f',
    ].join('\n');
    return {executable: 'osascript', args: ['-e', script]};
  }
  if (platform === 'linux') {
    return {
      executable: 'sh',
      args: ['-c', "xclip -selection clipboard -t image/png -o > '{{path}}' 2>/dev/null || wl-paste --type image/png > '{{path}}' 2>/dev/null"],
    };
  }
  return undefined;
}
