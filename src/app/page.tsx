"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type LockerStatus = "locked" | "completed";

type Target = {
  id: string;
  title: string;
  notes: string;
  reminderAt: string;
  lockedAt: string;
  status: LockerStatus;
};

const STORAGE_KEY = "target-locker:v1";
const MAX_TIMEOUT = 2_147_483_647;

const getTomorrow = () => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + 1);
  return base;
};

const parseTargets = (raw: unknown): Target[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const value = entry as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.title !== "string") {
        return undefined;
      }

      const reminderAt =
        typeof value.reminderAt === "string" ? value.reminderAt : undefined;
      const lockedAt =
        typeof value.lockedAt === "string" ? value.lockedAt : undefined;
      const status =
        value.status === "completed" || value.status === "locked"
          ? value.status
          : "locked";

      if (!reminderAt || !lockedAt) return undefined;

      return {
        id: value.id,
        title: value.title,
        notes: typeof value.notes === "string" ? value.notes : "",
        reminderAt,
        lockedAt,
        status,
      } satisfies Target;
    })
    .filter((item): item is Target => Boolean(item));
};

const formatCountdown = (now: Date, future: Date) => {
  const diff = future.getTime() - now.getTime();
  if (diff <= 0) return "ready to complete";

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  if (parts.length === 0) {
    const seconds = totalSeconds % 60;
    return `${seconds}s`;
  }

  return parts.join(" ");
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

const formatDate = (date: Date) =>
  date.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

export default function Home() {
  const [targets, setTargets] = useState<Target[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      return parseTargets(JSON.parse(stored));
    } catch {
      return [];
    }
  });
  const [now, setNow] = useState(() => new Date());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [notificationState, setNotificationState] = useState<
    "unsupported" | NotificationPermission
  >(() => {
    if (typeof window === "undefined") return "default";
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
  }, [targets]);

  const syncNotifications = (list: Target[]) => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    timers.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timers.current.clear();

    list
      .filter((target) => target.status === "locked")
      .forEach((target) => {
        const due = new Date(target.reminderAt).getTime();
        const delay = due - Date.now();
        if (delay <= 0 || delay > MAX_TIMEOUT) return;

        const timeoutId = window.setTimeout(() => {
          new Notification("Target Locker", {
            body: `Time to complete: ${target.title}`,
            tag: target.id,
          });
          timers.current.delete(target.id);
        }, delay);

        timers.current.set(target.id, timeoutId);
      });
  };

  useEffect(() => {
    syncNotifications(targets);
  }, [targets, notificationState]);

  const tomorrow = useMemo(() => {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + 1);
    return base;
  }, [now]);

  const addTarget = () => {
    if (!title.trim()) return;
    const [hours, minutes] = reminderTime.split(":").map((value) => Number(value) || 0);

    const reminderDate = getTomorrow();
    reminderDate.setHours(hours, minutes, 0, 0);

    const newTarget: Target = {
      id: crypto.randomUUID(),
      title: title.trim(),
      notes: notes.trim(),
      reminderAt: reminderDate.toISOString(),
      lockedAt: new Date().toISOString(),
      status: "locked",
    };

    setTargets((current) => [...current, newTarget]);
    setTitle("");
    setNotes("");
  };

  const markCompleted = (id: string) => {
    setTargets((current) =>
      current.map((target) =>
        target.id === id ? { ...target, status: "completed" } : target,
      ),
    );
  };

  const resetForTomorrow = () => {
    setTargets((current) =>
      current
        .filter((target) => target.status === "completed")
        .map((target) => {
          const reminderDate = getTomorrow();
          const existingReminder = new Date(target.reminderAt);
          reminderDate.setHours(
            existingReminder.getHours(),
            existingReminder.getMinutes(),
            0,
            0,
          );

          return {
            ...target,
            status: "locked",
            reminderAt: reminderDate.toISOString(),
            lockedAt: new Date().toISOString(),
          };
        }),
    );
  };

  const requestNotifications = async () => {
    if (notificationState === "unsupported") return;

    const permission = await Notification.requestPermission();
    setNotificationState(permission);
  };

  const lockedTargets = targets.filter((target) => target.status === "locked");
  const completedTargets = targets.filter(
    (target) => target.status === "completed",
  );

  const notificationMessage = (() => {
    if (notificationState === "unsupported") {
      return "Notifications are not supported on this device.";
    }

    if (notificationState === "default") {
      return "Enable browser notifications to get a reminder when each target unlocks.";
    }

    if (notificationState === "denied") {
      return "Notifications are blocked. Update your browser permissions to receive reminders.";
    }

    if (notificationState === "granted") {
      return "Notifications are on. We'll nudge you when each target unlocks.";
    }

    return null;
  })();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12 sm:px-10 lg:px-12">
        <header className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-wider text-indigo-300">
            Target Locker
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Lock tomorrow&apos;s targets today.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Capture the commitments you want to hit tomorrow, lock them in, and
            let your browser nudge you when it&apos;s time to show up. Stay
            accountable, one day at a time.
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-200 shadow">
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-indigo-200">
              Tomorrow · {formatDate(tomorrow)}
            </span>
            {notificationMessage ? (
              <span>{notificationMessage}</span>
            ) : null}
            {notificationState === "default" ? (
              <button
                onClick={requestNotifications}
                className="rounded-full border border-indigo-400 px-3 py-1 text-indigo-100 transition hover:border-indigo-300 hover:text-indigo-50"
              >
                Enable notifications
              </button>
            ) : null}
          </div>
        </header>

        <section className="grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl shadow-indigo-950/50 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-10 sm:p-8">
          <div className="space-y-5">
            <h2 className="text-xl font-semibold text-indigo-100">
              Lock a fresh target
            </h2>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-200">
                Target name
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What are you committing to?"
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-base text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add quick context, links, or checklists."
                  rows={4}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-base text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40"
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Reminder time
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(event) => setReminderTime(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-2.5 text-base text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={addTarget}
                className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-400/50"
                disabled={!title.trim()}
              >
                Lock it in
              </button>
              <button
                onClick={resetForTomorrow}
                className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500 hover:text-white"
                disabled={!completedTargets.length}
              >
                Relock completed for tomorrow
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <h2 className="text-xl font-semibold text-indigo-100">
              Tomorrow&apos;s lineup
            </h2>
            <div className="space-y-4">
              {lockedTargets.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-5 py-6 text-sm text-slate-300">
                  Nothing locked yet. Commit to at least one meaningful target
                  so you wake up with focus.
                </p>
              ) : (
                lockedTargets.map((target) => {
                  const reminder = new Date(target.reminderAt);
                  return (
                    <article
                      key={target.id}
                      className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 px-5 py-4 shadow shadow-indigo-950/40 transition hover:border-indigo-400"
                    >
                      <header className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-white">
                          {target.title}
                        </h3>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-indigo-200">
                          <span className="rounded-full border border-indigo-500/50 px-2 py-1">
                            {formatTime(reminder)}
                          </span>
                          <span className="rounded-full border border-indigo-500/30 px-2 py-1">
                            {formatCountdown(now, reminder)}
                          </span>
                        </div>
                      </header>
                      {target.notes ? (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                          {target.notes}
                        </p>
                      ) : null}
                      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                        <span>
                          Locked {formatTime(new Date(target.lockedAt))} ·{" "}
                          {formatDate(new Date(target.lockedAt))}
                        </span>
                        <button
                          onClick={() => markCompleted(target.id)}
                          className="rounded-lg border border-emerald-400 px-3 py-1.5 font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                        >
                          Mark complete
                        </button>
                      </footer>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-indigo-100">
              Completed targets
            </h2>
            <span className="text-sm text-slate-400">
              {completedTargets.length} done
            </span>
          </header>
          {completedTargets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-5 py-5 text-sm text-slate-400">
              Wins show up here once you mark targets complete.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {completedTargets.map((target) => {
                const reminder = new Date(target.reminderAt);
                return (
                  <article
                    key={target.id}
                    className="space-y-3 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-5 py-4"
                  >
                    <header className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-emerald-100">
                        {target.title}
                      </h3>
                      <span className="rounded-full border border-emerald-500/40 px-2 py-1 text-xs uppercase tracking-wide text-emerald-200">
                        {formatTime(reminder)}
                      </span>
                    </header>
                    {target.notes ? (
                      <p className="text-sm leading-relaxed text-emerald-100/80">
                        {target.notes}
                      </p>
                    ) : null}
                    <footer className="text-xs uppercase tracking-wide text-emerald-200/80">
                      Completed and ready to relock
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <footer className="border-t border-slate-900/60 bg-slate-950/90 px-6 py-6 text-center text-xs text-slate-500">
        Targets stay on your device. For the best results, keep this tab open
        so reminders fire on time.
      </footer>
    </div>
  );
}
