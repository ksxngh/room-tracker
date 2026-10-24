"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Room = { id: number; name: string };
type Provider = { id: number; name: string; role: string };
type Shift = {
  id: number; room_id: number; provider_id: number; weekday: number;
  start_time: string; end_time: string; kind: "shift" | "booked";
};
type Gap = { room_id: number; start: number; end: number };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const OPEN = 8 * 60;   // 8:00 am in minutes
const CLOSE = 18 * 60; // 6:00 pm
const SPAN = CLOSE - OPEN;
const HOURS = Array.from({ length: 11 }, (_, i) => OPEN + i * 60);

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const label = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60, h12 = ((h + 11) % 12) + 1;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
};
const pos = (m: number) => ((m - OPEN) / SPAN) * 100;

// Find the empty time in one room: everything between 8am-6pm not covered by a shift
function gapsFor(roomId: number, shifts: Shift[]): Gap[] {
  const taken = shifts
    .filter((s) => s.room_id === roomId)
    .map((s) => [toMin(s.start_time), toMin(s.end_time)])
    .sort((a, b) => a[0] - b[0]);
  const gaps: Gap[] = [];
  let cur = OPEN;
  for (const [s, e] of taken) {
    if (s > cur) gaps.push({ room_id: roomId, start: cur, end: s });
    cur = Math.max(cur, e);
  }
  if (cur < CLOSE) gaps.push({ room_id: roomId, start: cur, end: CLOSE });
  return gaps.filter((g) => g.end - g.start >= 30); // ignore gaps under 30 min
}

export default function Home() {
  const [day, setDay] = useState(1);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [picked, setPicked] = useState<Gap | null>(null);
  const [form, setForm] = useState({ provider_id: 0, start: "", end: "" });
  const [msg, setMsg] = useState("");

  async function load() {
    const [r, p, s] = await Promise.all([
      supabase.from("exam_rooms").select("*").order("id"),
      supabase.from("providers").select("*").order("name"),
      supabase.from("room_shifts").select("*"),
    ]);
    if (r.error || p.error || s.error) { setMsg("Couldn't load the schedule."); return; }
    setRooms(r.data as Room[]);
    setProviders(p.data as Provider[]);
    setShifts(s.data as Shift[]);
  }
  useEffect(() => { load(); }, []);

  const today = useMemo(() => shifts.filter((s) => s.weekday === day), [shifts, day]);
  const gaps = useMemo(
    () => rooms.flatMap((r) => gapsFor(r.id, today)).sort((a, b) => (b.end - b.start) - (a.end - a.start)),
    [rooms, today]
  );
  const report = rooms.map((r) => {
    const used = today.filter((s) => s.room_id === r.id)
      .reduce((t, s) => t + toMin(s.end_time) - toMin(s.start_time), 0);
    return { name: r.name, used, pct: Math.round((used / SPAN) * 100) };
  });
  const totalUsed = report.reduce((t, x) => t + x.used, 0);
  const freeHours = (SPAN * rooms.length - totalUsed) / 60;
  const usage = rooms.length ? Math.round((totalUsed / (SPAN * rooms.length)) * 100) : 0;

  const who = (id: number) => providers.find((p) => p.id === id)?.name ?? "?";
  const roomName = (id: number) => rooms.find((r) => r.id === id)?.name ?? "?";

  function pick(g: Gap) {
    setPicked(g);
    setMsg("");
    setForm({ provider_id: providers[0]?.id ?? 0, start: toTime(g.start), end: toTime(g.end) });
  }

  async function book() {
    if (!picked) return;
    const s = toMin(form.start), e = toMin(form.end);
    if (e <= s) return setMsg("End time has to be after start time.");
    if (s < picked.start || e > picked.end)
      return setMsg(`Pick a time between ${label(picked.start)} and ${label(picked.end)}.`);
    const { error } = await supabase.from("room_shifts").insert({
      room_id: picked.room_id, provider_id: form.provider_id, weekday: day,
      start_time: form.start, end_time: form.end, kind: "booked",
    });
    if (error) {
      // 23P01 = the database blocked an overlapping booking
      return setMsg(error.code === "23P01" ? "That overlaps another booking in this room." : "Booking failed: " + error.message);
    }
    setPicked(null);
    setMsg("Booked ✓");
    load();
  }

  async function cancel(id: number) {
    const { error } = await supabase.from("room_shifts").delete().eq("id", id);
    setMsg(error ? "Couldn't cancel: " + error.message : "Booking cancelled");
    load();
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-800">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Room Scheduler</h1>
          <p className="text-sm text-slate-500">
            See when exam rooms sit empty between shifts, and book that time for another provider. Demo data only.
          </p>
        </header>

        {/* Day tabs */}
        <div className="flex gap-2">
          {DAYS.map((d, i) => (
            <button key={d} onClick={() => { setDay(i + 1); setPicked(null); }}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${day === i + 1 ? "bg-slate-800 text-white" : "bg-white border"}`}>
              {d}
            </button>
          ))}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-white p-4 border"><div className="text-sm text-slate-500">Room usage today</div><div className="text-2xl font-bold">{usage}%</div></div>
          <div className="rounded-xl bg-white p-4 border"><div className="text-sm text-slate-500">Empty room hours</div><div className="text-2xl font-bold text-amber-600">{freeHours.toFixed(1)} hrs</div></div>
          <div className="rounded-xl bg-white p-4 border"><div className="text-sm text-slate-500">Open slots</div><div className="text-2xl font-bold">{gaps.length}</div></div>
        </div>

        {msg && <div className="rounded-lg bg-white border px-4 py-2 text-sm">{msg}</div>}

        {/* Schedule grid */}
        <div className="overflow-x-auto rounded-xl bg-white border p-4">
          <div className="min-w-[700px]">
            <div className="relative ml-20 h-6 text-xs text-slate-400">
              {HOURS.map((h) => (
                <span key={h} className="absolute -translate-x-1/2" style={{ left: `${pos(h)}%` }}>{label(h)}</span>
              ))}
            </div>
            {rooms.map((r) => (
              <div key={r.id} className="flex items-center border-t py-2">
                <div className="w-20 text-sm font-medium">{r.name}</div>
                <div className="relative h-12 flex-1 rounded bg-slate-50">
                  {today.filter((s) => s.room_id === r.id).map((s) => (
                    <div key={s.id}
                      className={`absolute top-0 flex h-full items-center justify-between gap-1 overflow-hidden rounded px-2 text-xs text-white ${s.kind === "booked" ? "bg-emerald-600" : "bg-blue-600"}`}
                      style={{ left: `${pos(toMin(s.start_time))}%`, width: `${pos(toMin(s.end_time)) - pos(toMin(s.start_time))}%` }}
                      title={`${who(s.provider_id)} ${label(toMin(s.start_time))}-${label(toMin(s.end_time))}`}>
                      <span className="truncate">{who(s.provider_id)}</span>
                      {s.kind === "booked" && (
                        <button onClick={() => cancel(s.id)} className="font-bold" title="Cancel booking">×</button>
                      )}
                    </div>
                  ))}
                  {gapsFor(r.id, today).map((g) => (
                    <button key={g.start} onClick={() => pick(g)}
                      className="absolute top-0 h-full truncate rounded border-2 border-dashed border-amber-400 bg-amber-50 px-2 text-xs text-amber-700 hover:bg-amber-100"
                      style={{ left: `${pos(g.start)}%`, width: `${pos(g.end) - pos(g.start)}%` }}>
                      Free {label(g.start)}-{label(g.end)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-blue-600" />Scheduled shift</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-emerald-600" />Booked gap</span>
            <span><span className="mr-1 inline-block h-3 w-3 rounded border-2 border-dashed border-amber-400" />Empty, click to book</span>
          </div>
        </div>

        {/* Booking form */}
        {picked && (
          <div className="rounded-xl border-2 border-amber-400 bg-white p-4 space-y-3">
            <h2 className="font-semibold">
              Book {roomName(picked.room_id)} on {DAYS[day - 1]} (free {label(picked.start)}-{label(picked.end)})
            </h2>
            <div className="flex flex-wrap gap-3">
              <select className="rounded border px-3 py-2" value={form.provider_id}
                onChange={(e) => setForm({ ...form, provider_id: Number(e.target.value) })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              </select>
              <input type="time" step={900} className="rounded border px-3 py-2" value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })} />
              <input type="time" step={900} className="rounded border px-3 py-2" value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })} />
              <button onClick={book} className="rounded bg-emerald-600 px-4 py-2 font-medium text-white">Book</button>
              <button onClick={() => setPicked(null)} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Biggest open slots */}
          <div className="rounded-xl bg-white border p-4">
            <h2 className="mb-2 font-semibold">Biggest open slots</h2>
            {gaps.slice(0, 6).map((g) => (
              <button key={`${g.room_id}-${g.start}`} onClick={() => pick(g)}
                className="flex w-full justify-between border-t py-2 text-left text-sm hover:bg-slate-50">
                <span>{roomName(g.room_id)}, {label(g.start)}-{label(g.end)}</span>
                <span className="text-slate-500">{((g.end - g.start) / 60).toFixed(1)} hrs</span>
              </button>
            ))}
          </div>

          {/* Usage report */}
          <div className="rounded-xl bg-white border p-4">
            <h2 className="mb-2 font-semibold">Room usage report ({DAYS[day - 1]})</h2>
            {report.map((x) => (
              <div key={x.name} className="flex items-center gap-3 border-t py-2 text-sm">
                <span className="w-16">{x.name}</span>
                <div className="h-2 flex-1 rounded bg-slate-100">
                  <div className="h-2 rounded bg-blue-600" style={{ width: `${x.pct}%` }} />
                </div>
                <span className="w-24 text-right text-slate-500">{(x.used / 60).toFixed(1)} hrs ({x.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}