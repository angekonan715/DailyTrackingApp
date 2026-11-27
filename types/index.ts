// Shared types. Keep in sync with supabase/migrations.

export type Priority = "low" | "medium" | "high";
export type TaskKind = "task" | "exercise" | "workout";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  priority: Priority | null;
  task_date: string; // YYYY-MM-DD
  kind: TaskKind;
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

export interface WeeklyInsight {
  user_id: string;
  week_start: string; // Monday, YYYY-MM-DD
  tips: string[];
  created_at: string;
}

export interface AiUsage {
  user_id: string;
  month: string; // YYYY-MM
  cost_cents: number;
}

export type GoalMetric = "tasks" | "workout_minutes" | "workouts" | "books" | "steps";

export interface Goal {
  user_id: string;
  metric: GoalMetric;
  weekly_target: number | null;
  monthly_target: number | null;
  yearly_target: number | null;
}

export interface Hobby {
  id: string;
  user_id: string;
  name: string;
  note: string | null;
  created_at: string;
}

export interface HobbySession {
  id: string;
  user_id: string;
  hobby_id: string;
  day: string;
  note: string | null;
  created_at: string;
}

export interface NoteFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  folder_id: string | null;
  book_id: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface BookWord {
  id: string;
  user_id: string;
  book_id: string;
  word: string;
  definition: string;
  example: string;
  created_at: string;
  updated_at: string;
}
