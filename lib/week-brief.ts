import type { SupabaseClient } from "@supabase/supabase-js";
import { pagesLeft } from "@/lib/books";
import { buildWeekBrief, dayKeyInZone, nextWeekKey, streakEnding, weekStartKey } from "@/lib/coach";
import type { Book } from "@/types";

export async function loadWeekBrief(supabase: SupabaseClient, today: string, timeZone: string): Promise<string> {
  const weekStart = weekStartKey(today);
  const weekEnd = nextWeekKey(weekStart);
  const [tasksResult, workoutsResult, stepsResult, sessionsResult, booksResult, hobbiesResult] = await Promise.all([
    supabase.from("tasks").select("task_date, done").order("task_date", { ascending: false }).limit(2000),
    supabase
      .from("workouts")
      .select("started_at, duration_min, distance_km")
      .order("started_at", { ascending: false })
      .limit(1000),
    supabase.from("daily_steps").select("day, steps").gte("day", weekStart).lt("day", weekEnd),
    supabase.from("reading_sessions").select("day, pages_read").order("day", { ascending: false }).limit(2000),
    supabase.from("books").select("title, status, total_pages, current_page").eq("status", "reading"),
    supabase.from("hobbies").select("name").order("name").limit(12),
  ]);
  const loadError = tasksResult.error ?? workoutsResult.error ?? stepsResult.error ?? sessionsResult.error ?? booksResult.error;
  if (loadError) throw new Error(loadError.message);

  const tasks = (tasksResult.data ?? []) as { task_date: string; done: boolean }[];
  const weekTasks = tasks.filter((task) => task.task_date >= weekStart && task.task_date < weekEnd);
  const workouts = (workoutsResult.data ?? []) as {
    started_at: string;
    duration_min: number | string;
    distance_km: number | string | null;
  }[];
  const weekWorkouts = workouts.filter((workout) => {
    const day = dayKeyInZone(workout.started_at, timeZone);
    return day >= weekStart && day < weekEnd;
  });
  const stepRows = (stepsResult.data ?? []) as { steps: number }[];
  const sessions = (sessionsResult.data ?? []) as { day: string; pages_read: number | string }[];
  const weekSessions = sessions.filter((session) => session.day >= weekStart && session.day < weekEnd);
  const books = ((booksResult.data ?? []) as Pick<Book, "title" | "status" | "total_pages" | "current_page">[]).map(
    (book) => ({
      ...book,
      total_pages: Number(book.total_pages),
      current_page: Number(book.current_page),
    }),
  );
  const readingDays = new Set(weekSessions.map((session) => session.day));
  const hobbies = hobbiesResult.error
    ? []
    : ((hobbiesResult.data ?? []) as { name: string }[]).map((hobby) => hobby.name).filter(Boolean);

  return buildWeekBrief({
    today,
    tasksDone: weekTasks.filter((task) => task.done).length,
    tasksTotal: weekTasks.length,
    workoutCount: weekWorkouts.length,
    workoutMinutes: weekWorkouts.reduce((sum, workout) => sum + Number(workout.duration_min), 0),
    distanceKm: weekWorkouts.reduce((sum, workout) => sum + Number(workout.distance_km ?? 0), 0),
    steps: stepRows.length === 0 ? null : stepRows.reduce((sum, row) => sum + Number(row.steps), 0),
    pagesRead: weekSessions.reduce((sum, session) => sum + Number(session.pages_read), 0),
    readingDays: readingDays.size,
    todoStreak: streakEnding(
      tasks.filter((task) => task.done).map((task) => task.task_date),
      today,
    ),
    activeStreak: streakEnding(
      workouts.map((workout) => dayKeyInZone(workout.started_at, timeZone)),
      today,
    ),
    readingStreak: streakEnding(
      sessions.map((session) => session.day),
      today,
    ),
    books: books.map((book) => ({ title: book.title, pagesLeft: pagesLeft(book) })),
    hobbies,
  });
}
