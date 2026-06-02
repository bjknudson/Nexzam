import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { DesktopContext } from "./types";

type PaneKind = "questions" | "assets" | "standards" | "test-preview";

interface OpenPaneWindowOptions {
  mode?: string;
  width?: number;
  height?: number;
}

function getPaneWindowLabel(pane: PaneKind, mode?: string): string {
  return mode ? `nexzam-${pane}-${mode}-pane` : `nexzam-${pane}-pane`;
}

export function isDesktopShell(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getDesktopContext(): Promise<DesktopContext | null> {
  if (!isDesktopShell()) return null;
  return invoke<DesktopContext>("get_desktop_context");
}

export async function openBankDialog(): Promise<string | null> {
  if (!isDesktopShell()) return null;
  return invoke<string | null>("open_bank_dialog");
}

export async function saveBankDialog(currentPath?: string | null): Promise<string | null> {
  if (!isDesktopShell()) return null;
  return invoke<string | null>("save_bank_dialog", {
    currentPath: currentPath ?? null,
  });
}

export async function setArchiveDirtyInShell(dirty: boolean): Promise<void> {
  if (!isDesktopShell()) return;
  await invoke("set_archive_dirty", { dirty });
}

export async function openPaneWindow(
  pane: PaneKind,
  title: string,
  options: OpenPaneWindowOptions = {},
): Promise<void> {
  const url = new URL(window.location.href);
  url.searchParams.set("pane", pane);
  if (options.mode) {
    url.searchParams.set("mode", options.mode);
  }

  const label = getPaneWindowLabel(pane, options.mode);

  if (!isDesktopShell()) {
    const popup = window.open(
      url.toString(),
      label,
      `popup=yes,width=${options.width ?? 1180},height=${options.height ?? 860},resizable=yes,scrollbars=no`,
    );
    if (!popup) {
      throw new Error(`Failed to open the ${pane} window.`);
    }
    popup.focus();
    return;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(label);

  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  const child = new WebviewWindow(label, {
    url: url.toString(),
    title,
    width: options.width ?? 1180,
    height: options.height ?? 860,
    resizable: true,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    void child.once("tauri://created", () => resolve());
    void child.once("tauri://error", (event) => reject(new Error(String(event.payload))));
  });
}

export async function watchPaneWindowClose(
  pane: PaneKind,
  onClose: () => void,
): Promise<UnlistenFn | null> {
  if (!isDesktopShell()) {
    return null;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(getPaneWindowLabel(pane));
  if (!existing) {
    return null;
  }

  return existing.once("tauri://destroyed", () => {
    onClose();
  });
}

export async function closeCurrentPaneWindow(): Promise<void> {
  if (!isDesktopShell()) {
    window.close();
    return;
  }

  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await getCurrentWebviewWindow().close();
}
