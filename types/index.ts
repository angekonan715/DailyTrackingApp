// Shared types. Keep in sync with supabase/migrations.

export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  priority: Priority | null;
  task_date: string; // YYYY-MM-DD
  done: boolean;
  position: number;
  created_at: string;
}

export type WorkoutType = "run" | "walk" | "ride" | "strength" | "yoga" | "other";
export type WorkoutSource = "manual" | "samsung";

export interface Workout {
  id: string;
  user_id: string;
  started_at: string; // ISO timestamp
  type: WorkoutType;
  duration_min: number;
  distance_km: number | null;
  calories: number | null;
  avg_heart_rate: number | null;
  notes: string | null;
  source: WorkoutSource;
  created_at: string;
}

export interface DailySteps {
  user_id: string;
  day: string; // YYYY-MM-DD
  steps: number;
}

export type BookStatus = "want" | "reading" | "finished";

export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  total_pages: number;
  current_page: number;
  status: BookStatus;
  cover_url: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  day: string; // YYYY-MM-DD
  pages_read: number;
}
