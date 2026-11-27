export const TRASH_DAYS = 30;

interface TrashFolder {
  id: string;
  parent_id: string | null;
  deleted_at?: string | null;
}

interface TrashNote {
  folder_id: string | null;
  deleted_at?: string | null;
}

export function explainNotesError(message: string): string {
  if (/notes_one_home/i.test(message)) {
    return "Book folders need one more script. In Supabase, open the SQL Editor, paste the book notes folders script, and run it.";
  }
  if (/deleted_at/i.test(message)) {
    return "Trash is not set up yet. In Supabase, open the SQL Editor, paste the trash script, and run it.";
  }
  if (/note_folders|schema cache|does not exist|relation/i.test(message)) {
    return "Notes are not set up yet. In Supabase, open the SQL Editor, paste the notes script, and run it.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) return "Your session expired. Sign in again.";
  if (/notes_body_len|40000/i.test(message)) return "This note is too long. Shorten it a little, then it will save.";
  if (/notes_title_len/i.test(message)) return "The title is too long.";
  if (/note_folders_name_len/i.test(message)) return "Folder names need 1 to 80 characters.";
  return message;
}

export function noteTitle(title: string): string {
  const clean = title.trim();
  return clean || "Untitled";
}

export function trashCutoff(now = Date.now()): string {
  return new Date(now - TRASH_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  const expires = new Date(deletedAt).getTime() + TRASH_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.min(TRASH_DAYS, Math.ceil((expires - now) / (24 * 60 * 60 * 1000))));
}

export function trashRemainLabel(deletedAt: string): string {
  const days = trashDaysLeft(deletedAt);
  if (days <= 1) return days === 1 ? "1 day left" : "Deletes today";
  return `${days} days left`;
}

export function ancestorInTrash(folders: TrashFolder[], startId: string | null): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = startId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) return false;
    if (folder.deleted_at) return true;
    current = folder.parent_id;
  }
  return false;
}

export function activeFolders<T extends TrashFolder>(folders: T[]): T[] {
  return folders.filter((folder) => !folder.deleted_at && !ancestorInTrash(folders, folder.parent_id));
}

export function activeNotes<T extends TrashNote>(notes: T[], folders: TrashFolder[]): T[] {
  return notes.filter((note) => !note.deleted_at && !ancestorInTrash(folders, note.folder_id));
}

export function trashedFolders<T extends TrashFolder>(folders: T[]): T[] {
  return folders.filter((folder) => folder.deleted_at && !ancestorInTrash(folders, folder.parent_id));
}

export function trashedNotes<T extends TrashNote>(notes: T[], folders: TrashFolder[]): T[] {
  return notes.filter((note) => note.deleted_at && !ancestorInTrash(folders, note.folder_id));
}
