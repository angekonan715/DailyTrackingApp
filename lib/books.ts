import type { Book, BookStatus, ReadingSession } from "@/types";
import { addDays, toDayKey } from "@/lib/dates";

export const BOOK_STATUSES: { value: BookStatus; label: string }[] = [
  { value: "want", label: "Want to read" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
];

export function bookStatusLabel(status: BookStatus): string {
  return BOOK_STATUSES.find((item) => item.value === status)?.label ?? "Reading";
}

export function normalizeBook(row: Book): Book {
  return {
    ...row,
    total_pages: Number(row.total_pages),
    current_page: Number(row.current_page),
  };
}

export function normalizeSession(row: ReadingSession): ReadingSession {
  return { ...row, pages_read: Number(row.pages_read) };
}

export function pagesLeft(book: Pick<Book, "total_pages" | "current_page">): number {
  return Math.max(0, book.total_pages - book.current_page);
}

export function percentComplete(book: Pick<Book, "total_pages" | "current_page">): number {
  if (book.total_pages <= 0) return 0;
  return Math.min(100, Math.round((book.current_page / book.total_pages) * 100));
}

export interface ReadingPace {
  pagesPerDay: number;
  readingDays: number;
}

/** Average pages on days that have a logged session. */
export function readingPace(sessions: ReadingSession[]): ReadingPace | null {
  if (sessions.length === 0) return null;
  const byDay = new Map<string, number>();
  for (const session of sessions) {
    byDay.set(session.day, (byDay.get(session.day) ?? 0) + session.pages_read);
  }
  const total = [...byDay.values()].reduce((sum, pages) => sum + pages, 0);
  if (byDay.size === 0 || total <= 0) return null;
  return { pagesPerDay: total / byDay.size, readingDays: byDay.size };
}

/** Calendar day the book would finish if the reader keeps the logged pace every day. */
export function estimatedFinishDay(
  book: Pick<Book, "total_pages" | "current_page">,
  sessions: ReadingSession[],
  today = new Date(),
): string | null {
  const left = pagesLeft(book);
  if (left <= 0) return null;
  const pace = readingPace(sessions);
  if (!pace || pace.pagesPerDay <= 0) return null;
  const days = Math.ceil(left / pace.pagesPerDay);
  return toDayKey(addDays(today, days));
}

export function finishedThisYear(books: Book[], year: string): Book[] {
  return books
    .filter((book) => book.status === "finished" && !!year && book.finished_at?.startsWith(year))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
}

export interface BookPatch {
  status?: BookStatus;
  currentPage?: number;
  totalPages?: number;
}

/** Apply a page or status change, finishing the book when the last page is reached. */
export function nextBookState(book: Book, patch: BookPatch, today: string): Pick<
  Book,
  "status" | "current_page" | "total_pages" | "finished_at"
> {
  const total = Math.max(1, Math.round(patch.totalPages ?? book.total_pages));
  let status = patch.status ?? book.status;
  let page = Math.round(patch.currentPage ?? book.current_page);
  page = Math.min(total, Math.max(0, page));

  if (status === "finished" || page >= total) {
    return {
      status: "finished",
      current_page: total,
      total_pages: total,
      finished_at: book.finished_at ?? today,
    };
  }

  if (status === "want" && page > 0) status = "reading";
  return {
    status,
    current_page: page,
    total_pages: total,
    finished_at: null,
  };
}
