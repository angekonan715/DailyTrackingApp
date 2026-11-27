export function explainNotesError(message: string): string {
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
