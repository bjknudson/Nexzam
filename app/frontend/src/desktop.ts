import { invoke } from "@tauri-apps/api/core";

import type { DesktopContext } from "./types";

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
