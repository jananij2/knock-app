"""Knock — seed the SQLite database.

Idempotent: drops every table, recreates the schema, and inserts the demo
shift. Run with `python seed.py` from the backend/ directory.

Scenario (per PRD):
  Hotel    : The Grimmauld
  Tech     : Dobby, Floors 2–5, shift 07:00–15:00
  Date     : 2026-05-30 (fresh start of shift)
  Jobs     : 5, all pending; no messages sent yet; shift_log open (no summary)
"""

from models import DB_PATH, get_db, init_db

SHIFT_DATE = "2026-05-30"

# Tables dropped child-first to respect foreign keys.
ALL_TABLES = [
    "protocol_skips",
    "escalations",
    "push_subscriptions",
    "messages",
    "shift_log",
    "tickets",
    "jobs",
    "rooms",
]


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

# rooms: PMS snapshot for the rooms referenced by this shift's jobs.
# vip is an explicit boolean (loyalty tier is display-only, drives no behavior).
ROOMS = [
    # room   flr occupancy   guest                  tier        room_type   vip checkout_time          adj_vip noise hk
    ("312", 3, "occupied", "Minerva McGonagall", "diamond", "Suite",    1, "2026-06-02T11:00:00", 0, 1, "clean"),
    ("214", 2, "checkout", "Ron Weasley",        "standard", "Standard", 0, "2026-05-30T11:00:00", 0, 0, "dirty"),
    ("408", 4, "occupied", "Hermione Granger",   "gold",     "Deluxe",   0, "2026-05-31T11:00:00", 0, 0, "clean"),
    ("301", 3, "checkout", "Draco Malfoy",       "standard", "Standard", 0, "2026-05-30T12:00:00", 0, 0, "dirty"),
    ("502", 5, "vacant",   None,                  None,       "Studio",   0, None,                  0, 0, "in_progress"),
]

# Filler rooms so each floor (2–5) reads like a real hotel floor (~10 rooms).
# The 5 job rooms above carry the "real" scenario state (including the amber
# checkouts); these extras have no jobs and default to a deterministic mix of
# occupied and vacant so the floor map looks lived-in.
_NAMED_ROOMS = {r[0] for r in ROOMS}
_FILLER_TYPES = ("Standard", "Deluxe", "Suite", "Studio")
FILLER_ROOMS = []
for _floor in (2, 3, 4, 5):
    for _n in range(1, 11):  # rooms x01–x10
        _num = f"{_floor}{_n:02d}"
        if _num in _NAMED_ROOMS:
            continue
        _occ = "occupied" if _n % 2 == 0 else "vacant"
        _hk = "dirty" if _occ == "occupied" else "clean"
        FILLER_ROOMS.append(
            # room  flr     occ   guest tier  room_type                 vip ckout adj noise hk
            (_num, _floor, _occ, None, None, _FILLER_TYPES[_n % len(_FILLER_TYPES)],
             0, None, 0, 0, _hk))

ALL_ROOMS = ROOMS + FILLER_ROOMS

# jobs: all pending at start of shift. Sorted here by urgency then time pressure
# for readability; the API does the real ordering.
JOBS = [
    # title                  room   flr pri       status     dispatched_at          job_type
    ("AC not cooling",        "312", 3, "urgent", "pending", "2026-05-30T07:42:00", "hvac"),
    ("Leaking faucet",        "214", 2, "urgent", "pending", "2026-05-30T08:05:00", "plumbing"),
    ("Shower drain clogged",  "408", 4, "high",   "pending", "2026-05-30T08:33:00", "plumbing"),
    ("Broken blinds",         "301", 3, "high",   "pending", "2026-05-30T09:11:00", "general"),
    ("Lightbulb replacement", "502", 5, "normal", "pending", "2026-05-30T09:47:00", "electrical"),
]

# tickets: prior history. Room 312 = 2 priors (repeat AC issue); Room 214 = 1.
TICKETS = [
    # room   date          description                                                       resolution                                                     resolved
    ("312", "2026-04-18", "Guest reported AC blowing warm air, room not cooling below 75F.", "Recharged refrigerant and cleaned condenser coils. Cooling restored.", 1),
    ("312", "2026-05-09", "AC cooling intermittently; warm during afternoon peak.",          "Replaced faulty thermostat sensor and retested cycle.",               1),
    ("214", "2026-05-21", "Bathroom sink faucet dripping steadily.",                         "Replaced worn washer and cartridge.",                                 1),
]

# shift_log: one open row for today's shift; summaries filled at end of shift.
SHIFT = (
    "Dobby",            # tech_name
    SHIFT_DATE,         # shift_date
    "07:00",            # shift_start
    "15:00",            # shift_end
    None,               # ai_summary  (NULL until confirmed)
    None,               # handoff_note (NULL until confirmed)
)


def seed() -> None:
    conn = get_db()
    try:
        # Drop everything, then rebuild the schema cleanly.
        conn.execute("PRAGMA foreign_keys = OFF")
        for table in ALL_TABLES:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON")

        init_db(conn)

        conn.executemany(
            """INSERT INTO rooms
                 (room_number, floor, occupancy_status, guest_name, guest_loyalty_tier, room_type, vip,
                  checkout_time, adjacent_vip, noise_sensitivity_flag, housekeeping_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ALL_ROOMS,
        )

        conn.executemany(
            """INSERT INTO jobs
                 (title, room_number, floor, priority, status, dispatched_at, job_type)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            JOBS,
        )

        conn.executemany(
            """INSERT INTO tickets (room_number, date, description, resolution, resolved)
               VALUES (?, ?, ?, ?, ?)""",
            TICKETS,
        )

        conn.execute(
            """INSERT INTO shift_log
                 (tech_name, shift_date, shift_start, shift_end, ai_summary, handoff_note)
               VALUES (?, ?, ?, ?, ?, ?)""",
            SHIFT,
        )

        conn.commit()

        # Report what landed.
        counts = {
            t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            for t in ("rooms", "jobs", "tickets", "shift_log",
                      "messages", "push_subscriptions", "escalations", "protocol_skips")
        }
    finally:
        conn.close()

    print(f"Seeded {DB_PATH}")
    for table, n in counts.items():
        print(f"  {table:<20} {n}")


if __name__ == "__main__":
    seed()
