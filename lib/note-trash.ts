import { createClient } from "@/lib/supabase/client";
import { trashCutoff } from "@/lib/notes";

export async function purgeExpiredTrash(): Promise<void> {
  const supabase = createClient();
  const cutoff = trashCutoff();
  await supabase.from("note_folders").delete().lt("deleted_at", cutoff);
  await supabase.from("notes").delete().lt("deleted_at", cutoff);
}

export async function moveNoteToTrash(id: string): Promise<string | null> {
  const { error } = await createClient().from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  return error?.message ?? null;
}

export async function moveFolderToTrash(id: string): Promise<string | null> {
  const { error } = await createClient().from("note_folders").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  return error?.message ?? null;
}

export async function restoreNote(id: string): Promise<string | null> {
  const { error } = await createClient().from("notes").update({ deleted_at: null }).eq("id", id);
  return error?.message ?? null;
}

export async function restoreFolder(id: string): Promise<string | null> {
  const { error } = await createClient().from("note_folders").update({ deleted_at: null }).eq("id", id);
  return error?.message ?? null;
}

export async function destroyNote(id: string): Promise<string | null> {
  const { error } = await createClient().from("notes").delete().eq("id", id);
  return error?.message ?? null;
}

export async function destroyFolder(id: string): Promise<string | null> {
  const { error } = await createClient().from("note_folders").delete().eq("id", id);
  return error?.message ?? null;
}

export async function emptyTrash(): Promise<string | null> {
  const supabase = createClient();
  const folders = await supabase.from("note_folders").delete().not("deleted_at", "is", null);
  if (folders.error) return folders.error.message;
  const notes = await supabase.from("notes").delete().not("deleted_at", "is", null);
  return notes.error?.message ?? null;
}
