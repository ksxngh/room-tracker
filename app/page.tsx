"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// ---------- Types: what a room looks like ----------
type Status = "free" | "in_use" | "cleaning";
type Room = {
  id: number;
  name: string;
  status: Status;
  staff: string | null;
  updated_at: string;
};

// ---------- Colors + labels for each status ----------
const STYLES: Record<Status, { label: string; card: string; dot: string }> = {
  free:     { label: "Free",     card: "bg-green-50 border-green-500",   dot: "bg-green-500" },
  in_use:   { label: "In use",   card: "bg-red-50 border-red-500",       dot: "bg-red-500" },
  cleaning: { label: "Cleaning", card: "bg-yellow-50 border-yellow-500", dot: "bg-yellow-500" },
};

// "2 min ago" style text
function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ago`;
}

export default function Home() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Load all rooms once when the page opens
    supabase
      .from("rooms")
      .select("*")
      .order("id")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRooms(data as Room[]);
      });

    // 2. Listen for changes: when any room is updated, swap in the new version
    const channel = supabase
      .channel("rooms-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms" },
        (payload) => {
          const updated = payload.new as Room;
          setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        }
      )
      .subscribe();

    // 3. Stop listening when the page closes
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // When someone taps a status button
  async function setStatus(room: Room, status: Status) {
    let staff: string | null = null;
    if (status === "in_use") {
      staff = prompt(`Who is using ${room.name}?`, room.staff ?? "");
      if (staff === null) return; // they pressed Cancel
    }
    const { error } = await supabase
      .from("rooms")
      .update({ status, staff, updated_at: new Date().toISOString() })
      .eq("id", room.id);
    if (error) setError(error.message);
  }

  const count = (s: Status) => rooms.filter((r) => r.status === s).length;

  return (
    <main className="min-h-screen bg-gray-100 p-4 text-gray-900">
      <h1 className="text-2xl font-bold">Clinic Rooms</h1>
      <p className="mb-4 text-sm text-gray-600">
        {count("free")} free · {count("in_use")} in use · {count("cleaning")} cleaning
      </p>

      {error && <p className="mb-4 rounded bg-red-100 p-2 text-red-700">Error: {error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rooms.map((room) => {
          const s = STYLES[room.status];
          return (
            <div key={room.id} className={`rounded-xl border-2 p-3 ${s.card}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{room.name}</h2>
                <span className={`h-3 w-3 rounded-full ${s.dot}`} />
              </div>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="min-h-5 text-sm text-gray-700">{room.staff ?? ""}</p>
              <p className="mb-2 text-xs text-gray-500">{timeAgo(room.updated_at)}</p>

              <div className="flex gap-1">
                {(Object.keys(STYLES) as Status[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatus(room, st)}
                    disabled={room.status === st}
                    className="flex-1 rounded bg-white px-1 py-2 text-xs font-medium shadow disabled:opacity-40"
                  >
                    {STYLES[st].label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}