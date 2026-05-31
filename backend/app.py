"""Knock — Flask API.

All PRD endpoints plus a few additions noted inline. The /api/ai/* endpoints
delegate to ai.py (real Claude, with templated fallback); push delivery lives
in push.py.

Core principle enforced here: AI output is never auto-sent or auto-logged.
Messages are only stored via an explicit POST; escalations/closes require an
explicit POST carrying the (tech-confirmed) text.
"""

import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, abort, send_from_directory
from flask_cors import CORS

import ai
import push
from models import BACKEND_DIR, get_db, init_db

load_dotenv()  # load ANTHROPIC_API_KEY etc. from backend/.env if present (won't override real env)

# Dev/demo endpoints (/api/dev/*) reseed the DB and dispatch fake jobs — handy
# for demos but unauthenticated, so they're off unless explicitly enabled.
DEV_ROUTES_ENABLED = os.environ.get("ENABLE_DEV_ROUTES", "").lower() in (
    "1", "true", "yes", "on")

# The Vite build is emitted to frontend/dist (sibling of backend/). In production
# Flask serves those static files itself so the whole app is one origin / one
# Railway service. In local dev the Vite server proxies /api here instead.
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"

# static_folder=None: we handle static + SPA fallback ourselves (see serve_spa).
app = Flask(__name__, static_folder=None)
CORS(app)  # harmless in prod (same origin); needed for the Vite dev server

PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def row_to_dict(row):
    return dict(row) if row is not None else None


# ---------------------------------------------------------------------------
# Assembly helpers
# ---------------------------------------------------------------------------
def _room(conn, room_number):
    return row_to_dict(conn.execute(
        "SELECT * FROM rooms WHERE room_number = ?", (room_number,)).fetchone())


def _tickets(conn, room_number, limit=None):
    sql = "SELECT * FROM tickets WHERE room_number = ? ORDER BY date DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [row_to_dict(r) for r in conn.execute(sql, (room_number,)).fetchall()]


def _job(conn, job_id):
    return row_to_dict(conn.execute(
        "SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())


def _flags(room, ticket_count):
    """Color-dot flags for a job card:
      occupied  (red)    = occupancy_status == 'occupied'
      vip       (gold)   = room.vip boolean (loyalty tier does NOT drive this)
      repeat    (purple) = room has >= 1 prior ticket
      checkout  (green)  = occupancy_status == 'checkout' (imminent departure)
    """
    occ = room["occupancy_status"] if room else None
    return {
        "occupied": occ == "occupied",
        "vip": bool(room["vip"]) if room else False,
        "repeat_issue": ticket_count > 0,
        "checkout_imminent": occ == "checkout",
    }


def _job_card(conn, job):
    """Job dict enriched with flags for the home list."""
    room = _room(conn, job["room_number"])
    ticket_count = conn.execute(
        "SELECT COUNT(*) FROM tickets WHERE room_number = ?",
        (job["room_number"],)).fetchone()[0]
    card = dict(job)
    card["findings"] = json.loads(job["findings"] or "[]")
    card["flags"] = _flags(room, ticket_count)
    card["checkout_time"] = room["checkout_time"] if room else None
    return card


def _sort_key(card):
    """Urgency → VIP → imminent checkout time → dispatch time (PRD ordering)."""
    f = card["flags"]
    return (
        PRIORITY_RANK.get(card["priority"], 99),
        0 if f["vip"] else 1,
        0 if f["checkout_imminent"] else 1,
        card["checkout_time"] or "9999",
        card["dispatched_at"],
    )


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
@app.get("/api/jobs")
def list_jobs():
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM jobs").fetchall()
        cards = [_job_card(conn, dict(r)) for r in rows]
    finally:
        conn.close()
    cards.sort(key=_sort_key)
    return jsonify(cards)


@app.post("/api/jobs")
def create_job():
    """Create a tech self-logged (ad-hoc) job. Not in the original PRD, but the
    'Log ad-hoc job' flow needs it. Creates the room if it doesn't exist yet."""
    data = request.get_json(force=True) or {}
    room_number = str(data.get("room_number") or "").strip()
    title = (data.get("title") or "").strip()
    job_type = data.get("job_type", "general")
    priority = data.get("priority", "normal")
    if not room_number or not title:
        abort(400, description="room_number and title are required")
    if job_type not in ("hvac", "plumbing", "electrical", "general"):
        abort(400, description="invalid job_type")
    if priority not in ("urgent", "high", "normal"):
        priority = "normal"
    floor = int(room_number[0]) if room_number[:1].isdigit() else 0

    conn = get_db()
    try:
        if not _room(conn, room_number):
            conn.execute(
                """INSERT INTO rooms (room_number, floor, occupancy_status, vip, housekeeping_status)
                   VALUES (?, ?, 'vacant', 0, 'clean')""",
                (room_number, floor))
        cur = conn.execute(
            """INSERT INTO jobs (title, room_number, floor, priority, status,
                                 dispatched_at, job_type, source)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, 'adhoc')""",
            (title, room_number, floor, priority, now_iso(), job_type))
        conn.commit()
        job = _job(conn, cur.lastrowid)
        job["findings"] = json.loads(job["findings"] or "[]")
    finally:
        conn.close()
    return jsonify(job), 201


@app.get("/api/jobs/<int:job_id>")
def get_job(job_id):
    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        tickets = _tickets(conn, job["room_number"])
        job["findings"] = json.loads(job["findings"] or "[]")
        job["flags"] = _flags(room, len(tickets))
    finally:
        conn.close()
    return jsonify({"job": job, "room": room, "tickets": tickets})


@app.patch("/api/jobs/<int:job_id>/status")
def update_status(job_id):
    data = request.get_json(force=True) or {}
    status = data.get("status")
    if status not in ("pending", "in_progress", "resolved", "escalated"):
        abort(400, description="Invalid status")

    conn = get_db()
    try:
        if not _job(conn, job_id):
            abort(404, description="Job not found")
        sets = ["status = ?"]
        params = [status]
        if status == "in_progress":
            sets.append("started_at = COALESCE(started_at, ?)")
            params.append(now_iso())
        elif status == "resolved":
            sets.append("resolved_at = ?")
            params.append(now_iso())
        params.append(job_id)
        conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        job = _job(conn, job_id)
        job["findings"] = json.loads(job["findings"] or "[]")
    finally:
        conn.close()
    return jsonify(job)


@app.patch("/api/jobs/<int:job_id>/findings")
def update_findings(job_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        findings = data.get("findings", json.loads(job["findings"] or "[]"))
        if not isinstance(findings, list):
            abort(400, description="findings must be a list")
        tech_notes = data.get("tech_notes", job["tech_notes"])
        conn.execute(
            "UPDATE jobs SET findings = ?, tech_notes = ? WHERE id = ?",
            (json.dumps(findings), tech_notes, job_id))
        conn.commit()
        job = _job(conn, job_id)
        job["findings"] = json.loads(job["findings"] or "[]")
    finally:
        conn.close()
    return jsonify(job)


# ---------------------------------------------------------------------------
# Rooms — mid-job context correction (tech's correction is ground truth)
# ---------------------------------------------------------------------------
@app.get("/api/rooms")
def list_rooms():
    """All rooms, ordered by floor then number — backs the floor-map view."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM rooms ORDER BY floor, room_number").fetchall()
    finally:
        conn.close()
    return jsonify([row_to_dict(r) for r in rows])


@app.patch("/api/rooms/<room_number>")
def correct_room(room_number):
    """Update PMS room context when the tech finds it stale.
    Not in the PRD endpoint list, but the "Update room status" flow needs it.
    The correction is logged (timestamped) onto the job's tech_notes when a
    job_id is supplied — single tech, so attribution is implicit. Flag if
    you'd rather have a dedicated corrections table.
    """
    data = request.get_json(force=True) or {}
    allowed = ("occupancy_status", "vip", "guest_name", "guest_loyalty_tier",
               "checkout_time", "housekeeping_status", "noise_sensitivity_flag")
    fields = {k: data[k] for k in allowed if k in data}
    if "occupancy_status" in fields and fields["occupancy_status"] not in (
            "occupied", "vacant", "checkout", "checkin"):
        abort(400, description="Invalid occupancy_status")
    if not fields:
        abort(400, description="No updatable fields provided")

    conn = get_db()
    try:
        if not _room(conn, room_number):
            abort(404, description="Room not found")
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE rooms SET {sets} WHERE room_number = ?",
                     [*fields.values(), room_number])

        job_id = data.get("job_id")
        if job_id and _job(conn, job_id):
            change = ", ".join(f"{k}={v}" for k, v in fields.items())
            line = f"[correction {now_iso()}] room {room_number}: {change}"
            prev = _job(conn, job_id)["tech_notes"] or ""
            conn.execute("UPDATE jobs SET tech_notes = ? WHERE id = ?",
                         (f"{prev}\n{line}".strip(), job_id))
        conn.commit()
        room = _room(conn, room_number)
    finally:
        conn.close()
    return jsonify(room)


# ---------------------------------------------------------------------------
# Messages  (only stored after explicit tech confirmation)
# ---------------------------------------------------------------------------
@app.get("/api/messages")
def all_threads():
    """Inbox view: one thread per job that has messages, newest activity first."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT m.job_id, m.content, m.sent_at, m.direction,
                      j.title AS job_title, j.room_number AS job_room
               FROM messages m JOIN jobs j ON j.id = m.job_id
               ORDER BY m.sent_at ASC""").fetchall()
    finally:
        conn.close()
    threads = {}
    for r in rows:
        t = threads.setdefault(r["job_id"], {
            "job_id": r["job_id"], "title": r["job_title"],
            "room_number": r["job_room"], "count": 0,
        })
        t["count"] += 1
        t["last"] = r["content"]
        t["last_at"] = r["sent_at"]
        t["last_direction"] = r["direction"]
    return jsonify(sorted(threads.values(), key=lambda x: x["last_at"], reverse=True))


@app.get("/api/jobs/<int:job_id>/messages")
def list_messages(job_id):
    conn = get_db()
    try:
        if not _job(conn, job_id):
            abort(404, description="Job not found")
        rows = conn.execute(
            "SELECT * FROM messages WHERE job_id = ? ORDER BY sent_at ASC",
            (job_id,)).fetchall()
    finally:
        conn.close()
    return jsonify([row_to_dict(r) for r in rows])


@app.post("/api/jobs/<int:job_id>/messages")
def send_message(job_id):
    data = request.get_json(force=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        abort(400, description="content is required")
    direction = data.get("direction", "outbound")
    if direction not in ("outbound", "inbound"):
        abort(400, description="Invalid direction")

    conn = get_db()
    try:
        if not _job(conn, job_id):
            abort(404, description="Job not found")
        cur = conn.execute(
            """INSERT INTO messages (job_id, direction, content, sent_at, confirmed_by_tech)
               VALUES (?, ?, ?, ?, ?)""",
            (job_id, direction, content, now_iso(),
             1 if direction == "outbound" else 0))
        conn.commit()
        msg = row_to_dict(conn.execute(
            "SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()
    return jsonify(msg), 201


# ---------------------------------------------------------------------------
# Escalation
# ---------------------------------------------------------------------------
@app.post("/api/jobs/<int:job_id>/escalate")
def escalate(job_id):
    data = request.get_json(force=True) or {}
    reason_chips = data.get("reason_chips", [])
    note = data.get("note")
    routing_summary = data.get("ai_routing_summary")  # tech-confirmed text, optional

    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        prior = conn.execute(
            "SELECT COUNT(*) FROM tickets WHERE room_number = ?",
            (job["room_number"],)).fetchone()[0]

        routed = ai.escalation_routing(job, room, reason_chips, prior)["routing"]

        conn.execute(
            """INSERT INTO escalations
                 (job_id, reason_chips, note, ai_routing_summary,
                  supervisor_notified, front_desk_notified, engineering_log_notified, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (job_id, json.dumps(reason_chips), note, routing_summary,
             1 if routed["supervisor"] else 0,
             1 if routed["front_desk"] else 0,
             1 if routed["engineering_log"] else 0,
             now_iso()))
        conn.execute("UPDATE jobs SET status = 'escalated' WHERE id = ?", (job_id,))
        conn.commit()
        esc = row_to_dict(conn.execute(
            "SELECT * FROM escalations WHERE job_id = ? ORDER BY id DESC LIMIT 1",
            (job_id,)).fetchone())
        esc["reason_chips"] = json.loads(esc["reason_chips"] or "[]")
    finally:
        conn.close()
    return jsonify(esc), 201


# ---------------------------------------------------------------------------
# Protocol skips (VIP soft gate)
# ---------------------------------------------------------------------------
@app.post("/api/jobs/<int:job_id>/protocol-skip")
def protocol_skip(job_id):
    """Logged when a tech proceeds into a VIP room without notifying.
    Not in the PRD's endpoint list, but required by the soft-gate flow
    (friction + log + supervisor alert). Flag if you'd rather fold this in.
    """
    data = request.get_json(force=True) or {}
    conn = get_db()
    try:
        if not _job(conn, job_id):
            abort(404, description="Job not found")
        cur = conn.execute(
            """INSERT INTO protocol_skips (job_id, skip_type, detail, supervisor_notified, created_at)
               VALUES (?, ?, ?, 1, ?)""",
            (job_id, data.get("skip_type", "vip_no_message"),
             data.get("detail"), now_iso()))
        conn.commit()
        skip = row_to_dict(conn.execute(
            "SELECT * FROM protocol_skips WHERE id = ?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()
    return jsonify(skip), 201


# ---------------------------------------------------------------------------
# AI endpoints (placeholder generators until step 4)
# ---------------------------------------------------------------------------
@app.post("/api/ai/context")
def ai_context():
    """Context summary (read-only) + guest message draft. Caches the summary."""
    data = request.get_json(force=True) or {}
    job_id = data.get("job_id")
    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        tickets = _tickets(conn, job["room_number"], limit=3)
        tech_name = data.get("tech_name") or _shift_tech(conn)
        result = ai.context_and_message(
            job, room, tickets, tech_name, data.get("eta_minutes", 15))
        conn.execute("UPDATE jobs SET ai_context_summary = ? WHERE id = ?",
                     (result["context_summary"], job_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify(result)


@app.post("/api/ai/resolution")
def ai_resolution():
    """Resolution summary + close-out message draft. Caches the summary."""
    data = request.get_json(force=True) or {}
    job_id = data.get("job_id")
    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        tickets = _tickets(conn, job["room_number"], limit=3)
        chips = data.get("findings", json.loads(job["findings"] or "[]"))
        tech_notes = data.get("tech_notes", job["tech_notes"] or "")
        result = ai.resolution_and_closeout(job, room, chips, tech_notes, tickets)
        conn.execute("UPDATE jobs SET ai_resolution_summary = ? WHERE id = ?",
                     (result["resolution_summary"], job_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify(result)


@app.post("/api/ai/photo-note")
def ai_photo_note():
    """Generate a draft maintenance note from a job-site photo (Claude vision).
    Read-only draft — the tech edits it in the notes field before it's saved via
    PATCH /api/jobs/<id>/findings. Accepts a data URL or raw base64 image.
    """
    data = request.get_json(force=True) or {}
    job_id = data.get("job_id")
    image = data.get("image") or ""
    # Accept a full data URL ("data:image/jpeg;base64,...") or raw base64.
    media_type = "image/jpeg"
    if image.startswith("data:"):
        header, _, image = image.partition(",")
        if ";" in header and ":" in header:
            media_type = header.split(":", 1)[1].split(";", 1)[0] or media_type
    if not image:
        abort(400, description="image is required")

    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        result = ai.note_from_photo(job, room, media_type, image)
    finally:
        conn.close()
    return jsonify(result)


@app.post("/api/ai/escalation")
def ai_escalation():
    """Escalation routing summary PREVIEW (who gets notified + why).
    Read-only — shown when the escalate screen opens, before the tech confirms.
    The committing write is POST /api/jobs/<id>/escalate.
    """
    data = request.get_json(force=True) or {}
    job_id = data.get("job_id")
    conn = get_db()
    try:
        job = _job(conn, job_id)
        if not job:
            abort(404, description="Job not found")
        room = _room(conn, job["room_number"])
        prior = conn.execute(
            "SELECT COUNT(*) FROM tickets WHERE room_number = ?",
            (job["room_number"],)).fetchone()[0]
        result = ai.escalation_routing(job, room, data.get("reason_chips", []), prior)
    finally:
        conn.close()
    return jsonify(result)


@app.post("/api/ai/handoff")
def ai_handoff():
    """End-of-shift summary (structured) + handoff note (narrative draft)."""
    conn = get_db()
    try:
        shift = row_to_dict(conn.execute(
            "SELECT * FROM shift_log ORDER BY id DESC LIMIT 1").fetchone())
        jobs = [dict(r) for r in conn.execute("SELECT * FROM jobs").fetchall()]
        esc_count = conn.execute("SELECT COUNT(*) FROM escalations").fetchone()[0]
        result = ai.shift_summary_and_handoff(shift or {}, jobs, esc_count)
    finally:
        conn.close()
    return jsonify(result)


# ---------------------------------------------------------------------------
# Shift
# ---------------------------------------------------------------------------
def _shift_tech(conn):
    row = conn.execute(
        "SELECT tech_name FROM shift_log ORDER BY id DESC LIMIT 1").fetchone()
    return row["tech_name"] if row else "the tech"


@app.get("/api/shift/summary")
def shift_summary():
    """Shift meta + chronological job log (read-only shift log screen)."""
    conn = get_db()
    try:
        shift = row_to_dict(conn.execute(
            "SELECT * FROM shift_log ORDER BY id DESC LIMIT 1").fetchone())
        jobs = [_job_card(conn, dict(r)) for r in conn.execute(
            "SELECT * FROM jobs ORDER BY dispatched_at ASC").fetchall()]
    finally:
        conn.close()
    return jsonify({"shift": shift, "jobs": jobs})


@app.post("/api/shift/reopen")
def shift_reopen():
    """Reopen a closed shift — clears the saved summary/handoff so the tech can
    return to the active shift view."""
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM shift_log ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            abort(404, description="No shift to reopen")
        conn.execute(
            "UPDATE shift_log SET handoff_note = NULL, ai_summary = NULL WHERE id = ?",
            (row["id"],))
        conn.commit()
        shift = row_to_dict(conn.execute(
            "SELECT * FROM shift_log WHERE id = ?", (row["id"],)).fetchone())
    finally:
        conn.close()
    return jsonify(shift)


@app.post("/api/shift/close")
def shift_close():
    """Persist the tech-confirmed handoff note + summary, closing the shift."""
    data = request.get_json(force=True) or {}
    handoff_note = data.get("handoff_note")
    ai_summary = data.get("ai_summary")
    if isinstance(ai_summary, (dict, list)):
        ai_summary = json.dumps(ai_summary)

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM shift_log ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            abort(404, description="No shift to close")
        conn.execute(
            "UPDATE shift_log SET handoff_note = ?, ai_summary = ? WHERE id = ?",
            (handoff_note, ai_summary, row["id"]))
        conn.commit()
        shift = row_to_dict(conn.execute(
            "SELECT * FROM shift_log WHERE id = ?", (row["id"],)).fetchone())
    finally:
        conn.close()
    return jsonify(shift)


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------
@app.get("/api/push/vapid-public-key")
def push_vapid_key():
    """The browser needs this as pushManager.subscribe({applicationServerKey})."""
    key = push.public_key()
    if not key:
        abort(404, description="Push not configured (run gen_vapid.py)")
    return jsonify({"public_key": key})


@app.post("/api/push/subscribe")
def push_subscribe():
    """Store a browser Push API subscription."""
    data = request.get_json(force=True) or {}
    endpoint = data.get("endpoint")
    keys = data.get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not (endpoint and p256dh and auth):
        abort(400, description="endpoint and keys.{p256dh,auth} are required")

    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh,
                                                   auth = excluded.auth""",
            (endpoint, p256dh, auth, now_iso()))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"subscribed": True}), 201


# ---------------------------------------------------------------------------
# Dev-only: dispatch a new job to demonstrate the push flow.
# NOT in the PRD (the MVP has no job-creation flow), but screen 9 / the push
# spec need something to fire on "new job creation". Inserts a sample job +
# its room, then pushes to all subscriptions. Gated behind ENABLE_DEV_ROUTES;
# when disabled the routes return 404 as if they didn't exist.
# ---------------------------------------------------------------------------
def _require_dev_routes():
    if not DEV_ROUTES_ENABLED:
        abort(404, description="Not found")



_DEMO_JOBS = [
    {"title": "Thermostat unresponsive", "room": "220", "floor": 2, "priority": "high",
     "job_type": "hvac", "occupancy": "occupied", "guest": "Lena Cho", "tier": "gold", "vip": 0},
    {"title": "Toilet running continuously", "room": "417", "floor": 4, "priority": "normal",
     "job_type": "plumbing", "occupancy": "checkout", "guest": "Sam Reyes", "tier": "standard", "vip": 0},
    {"title": "Power outlet sparking", "room": "508", "floor": 5, "priority": "urgent",
     "job_type": "electrical", "occupancy": "occupied", "guest": "Dana Hill", "tier": "diamond", "vip": 1},
]


@app.post("/api/dev/reset")
def dev_reset():
    """Re-run seed.py — drops everything and restores a fresh start-of-shift."""
    _require_dev_routes()
    import seed
    seed.seed()
    return jsonify({"reset": True})


@app.post("/api/dev/dispatch-job")
def dev_dispatch_job():
    _require_dev_routes()
    data = request.get_json(force=True) or {}
    conn = get_db()
    try:
        # pick the first demo job whose room isn't already in use this run
        existing = {r[0] for r in conn.execute("SELECT room_number FROM rooms").fetchall()}
        spec = next((d for d in _DEMO_JOBS if d["room"] not in existing), None)
        if not spec:
            abort(409, description="All demo jobs already dispatched — reseed to reset")

        conn.execute(
            """INSERT INTO rooms (room_number, floor, occupancy_status, guest_name,
                                  guest_loyalty_tier, vip, housekeeping_status)
               VALUES (?, ?, ?, ?, ?, ?, 'clean')""",
            (spec["room"], spec["floor"], spec["occupancy"], spec["guest"],
             spec["tier"], spec["vip"]))
        cur = conn.execute(
            """INSERT INTO jobs (title, room_number, floor, priority, status,
                                 dispatched_at, job_type)
               VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
            (spec["title"], spec["room"], spec["floor"], spec["priority"],
             now_iso(), spec["job_type"]))
        conn.commit()
        job_id = cur.lastrowid
    finally:
        conn.close()

    report = push.send_to_all({
        "title": f"New {spec['priority']} job",
        "body": f"{spec['title']} — Room {spec['room']}",
        "url": f"/jobs/{job_id}",
        "tag": f"knock-job-{job_id}",
    })
    return jsonify({"job_id": job_id, "push": report}), 201


# ---------------------------------------------------------------------------
# Errors / health
# ---------------------------------------------------------------------------
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(409)
def handle_error(err):
    return jsonify({"error": err.description}), err.code


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Static frontend (production single-service deploy)
# ---------------------------------------------------------------------------
# Serve the built SPA for every non-/api path. Real files (JS/CSS/sw.js) are
# returned directly; anything else falls back to index.html so client-side
# routes (e.g. /jobs/3) work on hard refresh / deep links.
@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def serve_spa(path):
    if path.startswith("api/"):  # unmatched API path — don't serve HTML for it
        abort(404, description="Not found")
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        # No build present (e.g. running the backend alone in local dev — use
        # the Vite dev server at :5173 instead, which proxies /api here).
        abort(404, description="Frontend not built. Run `npm run build` in frontend/.")
    target = FRONTEND_DIST / path
    if path and target.is_file():
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


if __name__ == "__main__":
    init_db()  # ensure tables exist (run seed.py to populate)
    # host=0.0.0.0 → reachable from other devices on the LAN (e.g. your phone)
    app.run(host="0.0.0.0", debug=True, port=5001)
