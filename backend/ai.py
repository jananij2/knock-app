"""Knock — AI generation layer (Claude API).

Real Claude calls via the Anthropic SDK (model: claude-sonnet-4-6, per project
spec). Design rules:

  - The model produces NATURAL LANGUAGE only (summaries, message drafts,
    narrative notes). Every decision that drives behavior — escalation routing,
    shift counts, the "Part needed" → escalate rule — is computed in Python and
    handed to the model to phrase. This keeps the app's logic deterministic and
    honors the PRD's "AI must not make escalation decisions autonomously."
  - All outputs are DRAFTS; the caller/tech confirms before anything is sent or
    logged (context summary is the one read-only exception).
  - Structured outputs (output_config.format) guarantee parseable JSON.
  - Short, latency-sensitive generations → thinking disabled + effort "low".
  - If a call fails (or no API key is configured), we fall back to a templated
    draft so the app never hard-breaks. "generated_by" reports which path ran:
    "claude" | "fallback".

Caching: a shared system preamble carries a cache_control breakpoint. The prefix
is currently below Sonnet 4.6's ~2048-token cache minimum, so it won't
materially cache yet — the structure is correct for when prompts grow.
"""

import json
import logging

import anthropic

MODEL = "claude-sonnet-4-6"
HOTEL_NAME = "The Grimmauld"
log = logging.getLogger("knock.ai")

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env
    return _client


SYSTEM_PREAMBLE = (
    f"You are the assistant inside Knock, a dispatch app used by the single "
    f"maintenance technician on shift at {HOTEL_NAME} (a hotel). You surface "
    "context and draft messages so the tech is prepared before they knock on a "
    "guest's door.\n"
    "Rules:\n"
    "- Be concise and plain-spoken. No filler, no preamble like 'Here is'.\n"
    "- Every output is a draft the tech reviews before anything is sent or logged.\n"
    "- Never promise a fix timeline or outcome in a guest message.\n"
    "- Guest messages are warm but brief; address the guest by name.\n"
    f"- In guest messages, identify the sender as the named technician from "
    f"{HOTEL_NAME} — name the hotel, never just 'the hotel'.\n"
    "- Use only the facts in the provided data. Do not invent guests, history, or causes."
)


def _complete(task_instructions: str, payload: dict, schema: dict,
              max_tokens: int = 700) -> dict:
    """One structured-output call. Raises on any API/parse error (caller handles)."""
    client = _get_client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        thinking={"type": "disabled"},
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": schema},
        },
        system=[
            {"type": "text", "text": SYSTEM_PREAMBLE},
            # cache breakpoint on the last system block → caches preamble + task
            {"type": "text", "text": task_instructions,
             "cache_control": {"type": "ephemeral"}},
        ],
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def _complete_with_image(task_instructions: str, payload: dict, media_type: str,
                         image_b64: str, schema: dict, max_tokens: int = 400) -> dict:
    """One structured-output call that also sees an image (Claude vision).

    Same contract as _complete, but the user turn carries an image block ahead of
    the JSON context so the model can describe what it sees. Raises on error.
    """
    client = _get_client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        thinking={"type": "disabled"},
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": schema},
        },
        system=[
            {"type": "text", "text": SYSTEM_PREAMBLE},
            {"type": "text", "text": task_instructions,
             "cache_control": {"type": "ephemeral"}},
        ],
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64",
                                         "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": json.dumps(payload, ensure_ascii=False)},
        ]}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def _obj(props: dict) -> dict:
    """Build a strict JSON schema object from {name: "string"} property specs."""
    return {
        "type": "object",
        "properties": {k: {"type": v} for k, v in props.items()},
        "required": list(props),
        "additionalProperties": False,
    }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _fmt_checkout(iso):
    if not iso:
        return "no scheduled checkout"
    date, _, time = iso.partition("T")
    return f"{time[:5]} on {date}" if time else date


def _tickets_payload(tickets):
    return [{"date": t["date"], "description": t["description"],
             "resolution": t.get("resolution")} for t in tickets]


# ---------------------------------------------------------------------------
# 1 + 2. Context summary  AND  guest message draft
# ---------------------------------------------------------------------------
CONTEXT_INSTRUCTIONS = (
    "Produce a situational briefing and a guest message draft for one maintenance job.\n"
    "- context_summary: 2-4 sentences for the technician — who is in the room, "
    "relevant prior history, and what to watch out for (VIP, noise sensitivity, "
    "imminent checkout). Read-only briefing.\n"
    "- message_draft: 1-3 sentences to the guest. Warm, brief, no promised fix "
    "outcome, includes the tech's name and ETA. If the room is vacant (no guest), "
    "message_draft MUST be an empty string."
)
CONTEXT_SCHEMA = _obj({"context_summary": "string", "message_draft": "string"})


def context_and_message(job, room, tickets, tech_name, eta_minutes=15):
    payload = {
        "job_title": job["title"],
        "room_number": job["room_number"],
        "urgency": job["priority"],
        "occupancy_status": room.get("occupancy_status"),
        "guest_name": room.get("guest_name"),
        "guest_loyalty_tier": room.get("guest_loyalty_tier"),
        "vip": bool(room.get("vip")),
        "noise_sensitive": bool(room.get("noise_sensitivity_flag")),
        "checkout_time": _fmt_checkout(room.get("checkout_time")),
        "prior_tickets": _tickets_payload(tickets),
        "tech_name": tech_name,
        "eta_minutes": eta_minutes,
    }
    try:
        out = _complete(CONTEXT_INSTRUCTIONS, payload, CONTEXT_SCHEMA, max_tokens=500)
        if room.get("occupancy_status") == "vacant":
            out["message_draft"] = ""
        return {**out, "generated_by": "claude"}
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        log.warning("context_and_message fell back to template: %s", e)
        return {**_fallback_context_and_message(job, room, tickets, tech_name, eta_minutes),
                "generated_by": "fallback"}


# ---------------------------------------------------------------------------
# 3 + 4. Resolution summary  AND  close-out message
# ---------------------------------------------------------------------------
RESOLUTION_INSTRUCTIONS = (
    "Write a resolution summary and a close-out guest message for a completed (or "
    "to-be-closed) maintenance job.\n"
    "- resolution_summary: 2-4 sentences for the ticket log — what was found and "
    "fixed, based on the selected findings and notes.\n"
    "- closeout_message: 1-2 sentences to the guest letting them know maintenance "
    "has finished. Warm, brief, no promised outcome."
)
RESOLUTION_SCHEMA = _obj({"resolution_summary": "string", "closeout_message": "string"})


def resolution_and_closeout(job, room, chips, tech_notes, tickets):
    # Deterministic: "Part needed" chip recommends escalation instead of close.
    part_needed = any("part" in c.lower() for c in chips)
    escalation = {
        "recommend_escalation": part_needed,
        "recommend_escalation_reason":
            "Part needed — escalate rather than close." if part_needed else None,
    }
    payload = {
        "job_title": job["title"],
        "room_number": job["room_number"],
        "job_type": job["job_type"],
        "findings_chips": chips,
        "tech_notes": tech_notes,
        "guest_name": room.get("guest_name"),
        "prior_ticket_count": len(tickets),
    }
    try:
        out = _complete(RESOLUTION_INSTRUCTIONS, payload, RESOLUTION_SCHEMA, max_tokens=500)
        return {**out, **escalation, "generated_by": "claude"}
    except Exception as e:  # noqa: BLE001
        log.warning("resolution_and_closeout fell back to template: %s", e)
        fb = _fallback_resolution_and_closeout(job, room, chips, tech_notes, tickets)
        return {**fb, **escalation, "generated_by": "fallback"}


# ---------------------------------------------------------------------------
# 4b. Maintenance note from a job-site photo (Claude vision)
# ---------------------------------------------------------------------------
PHOTO_NOTE_INSTRUCTIONS = (
    "You are shown a photo taken by the technician at a maintenance job, plus the "
    "job context. Write maintenance_note: 1-3 plain sentences describing what the "
    "photo shows that is relevant to this job — the visible condition, damage, or "
    "part — as a note for the ticket log. Describe only what is actually visible; "
    "do not guess at causes you cannot see. This is a draft the tech edits before saving."
)
PHOTO_NOTE_SCHEMA = _obj({"maintenance_note": "string"})


def note_from_photo(job, room, media_type, image_b64):
    payload = {
        "job_title": job["title"],
        "room_number": job["room_number"],
        "job_type": job["job_type"],
    }
    try:
        out = _complete_with_image(PHOTO_NOTE_INSTRUCTIONS, payload, media_type,
                                   image_b64, PHOTO_NOTE_SCHEMA, max_tokens=400)
        return {"maintenance_note": out["maintenance_note"], "generated_by": "claude"}
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        log.warning("note_from_photo fell back to template: %s", e)
        return {"maintenance_note": _fallback_photo_note(job),
                "generated_by": "fallback"}


# ---------------------------------------------------------------------------
# 4c. Ad-hoc job title suggestions (from the tech's free-text description)
# ---------------------------------------------------------------------------
TITLE_INSTRUCTIONS = (
    "The technician typed a free-text description of a maintenance problem they "
    "found. Suggest exactly 3 short, professional job titles (3-6 words each) that "
    "could head this job's ticket. Title-case, specific to the description and job "
    "type, no trailing punctuation. Order from most to least likely."
)
TITLE_SCHEMA = {
    "type": "object",
    "properties": {"titles": {"type": "array", "items": {"type": "string"}}},
    "required": ["titles"],
    "additionalProperties": False,
}


def suggest_titles(description, job_type):
    payload = {"description": description, "job_type": job_type}
    try:
        out = _complete(TITLE_INSTRUCTIONS, payload, TITLE_SCHEMA, max_tokens=200)
        titles = [t.strip() for t in out.get("titles", []) if t and t.strip()][:3]
        if titles:
            return {"titles": titles, "generated_by": "claude"}
        raise ValueError("no titles returned")
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        log.warning("suggest_titles fell back to template: %s", e)
        return {"titles": _fallback_titles(description, job_type), "generated_by": "fallback"}


# ---------------------------------------------------------------------------
# 4d. Estimated time-to-complete per job (batched — one call for all home cards)
# ---------------------------------------------------------------------------
ESTIMATE_INSTRUCTIONS = (
    "Estimate how long each maintenance job will take and return a short label.\n"
    "Baselines by job type, adjusted UP when the room has a repeat issue (prior tickets):\n"
    "- hvac: ~20-30 min\n"
    "- plumbing: ~15-20 min\n"
    "- electrical: ~10 min\n"
    "- general: ~10-15 min\n"
    "Return one estimate per job, echoing its job_id. Each estimate must be of the "
    "form '~N min' or '~N-M min'."
)
ESTIMATE_SCHEMA = {
    "type": "object",
    "properties": {
        "estimates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "integer"},
                    "estimate": {"type": "string"},
                },
                "required": ["job_id", "estimate"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["estimates"],
    "additionalProperties": False,
}


def time_estimates(jobs):
    """jobs: list of {id, job_type, repeat}. Always returns one estimate per job
    (Claude where possible, heuristic fallback for any the model omits)."""
    payload = {"jobs": [{"job_id": j["id"], "job_type": j["job_type"],
                         "repeat_issue": bool(j["repeat"])} for j in jobs]}
    est_map = {}
    generated_by = "fallback"
    try:
        out = _complete(ESTIMATE_INSTRUCTIONS, payload, ESTIMATE_SCHEMA, max_tokens=400)
        est_map = {e["job_id"]: e["estimate"] for e in out.get("estimates", [])
                   if e.get("estimate")}
        if est_map:
            generated_by = "claude"
    except Exception as e:  # noqa: BLE001
        log.warning("time_estimates fell back to template: %s", e)
    estimates = [{"job_id": j["id"],
                  "estimate": est_map.get(j["id"]) or _fallback_estimate(j["job_type"], j["repeat"])}
                 for j in jobs]
    return {"estimates": estimates, "generated_by": generated_by}


# ---------------------------------------------------------------------------
# 5. Escalation routing summary
# ---------------------------------------------------------------------------
ROUTING_INSTRUCTIONS = (
    "Given a precomputed routing decision for an escalation, write routing_summary: "
    "a plain-language sentence or two telling the tech who will be notified and why. "
    "Do not change the decision — only describe the channels that are set to true."
)
ROUTING_SCHEMA = _obj({"routing_summary": "string"})


def escalation_routing(job, room, reason_chips, prior_ticket_count):
    # Deterministic routing rules (PRD): supervisor always; front desk if VIP;
    # engineering log if repeat issue or safety flag.
    chips_lower = [c.lower() for c in reason_chips]
    is_vip = bool(room.get("vip"))
    is_safety = any("safety" in c for c in chips_lower)
    is_repeat = prior_ticket_count > 0
    routing = {
        "supervisor": True,
        "front_desk": is_vip,
        "engineering_log": is_repeat or is_safety,
    }
    payload = {
        "job_title": job["title"],
        "room_number": job["room_number"],
        "reason_chips": reason_chips,
        "guest_is_vip": is_vip,
        "repeat_issue": is_repeat,
        "safety_flag": is_safety,
        "routing": routing,
    }
    try:
        out = _complete(ROUTING_INSTRUCTIONS, payload, ROUTING_SCHEMA, max_tokens=300)
        return {"routing": routing, "routing_summary": out["routing_summary"],
                "generated_by": "claude"}
    except Exception as e:  # noqa: BLE001
        log.warning("escalation_routing fell back to template: %s", e)
        return {"routing": routing,
                "routing_summary": _fallback_routing_summary(routing, is_vip, is_safety),
                "generated_by": "fallback"}


# ---------------------------------------------------------------------------
# 6. End-of-shift summary + handoff note
# ---------------------------------------------------------------------------
HANDOFF_INSTRUCTIONS = (
    "Write handoff_note: a short narrative note (3-5 sentences) addressed to the "
    "next technician, summarizing the shift from the provided structured stats and "
    "open items. Mention notable items (escalations, still-open jobs). Plain, direct."
)
HANDOFF_SCHEMA = _obj({"handoff_note": "string"})


def shift_summary_and_handoff(shift, jobs, escalation_count):
    # Deterministic structured summary.
    by_status = {}
    for j in jobs:
        by_status[j["status"]] = by_status.get(j["status"], 0) + 1
    completed = by_status.get("resolved", 0)
    escalated = by_status.get("escalated", 0)
    pending = by_status.get("pending", 0) + by_status.get("in_progress", 0)
    open_items = [f"{j['title']} (room {j['room_number']})"
                  for j in jobs if j["status"] in ("pending", "in_progress")]
    ai_summary = {
        "completed": completed, "escalated": escalated, "pending": pending,
        "total": len(jobs), "open_items": open_items,
    }
    payload = {
        "tech_name": shift.get("tech_name"),
        "shift_date": shift.get("shift_date"),
        "summary": ai_summary,
        "escalation_count": escalation_count,
    }
    try:
        out = _complete(HANDOFF_INSTRUCTIONS, payload, HANDOFF_SCHEMA, max_tokens=600)
        return {"ai_summary": ai_summary, "handoff_note": out["handoff_note"],
                "generated_by": "claude"}
    except Exception as e:  # noqa: BLE001
        log.warning("shift_summary_and_handoff fell back to template: %s", e)
        return {"ai_summary": ai_summary,
                "handoff_note": _fallback_handoff_note(shift, ai_summary, escalation_count),
                "generated_by": "fallback"}


# ===========================================================================
# Templated fallbacks (used when the API call fails or no key is configured)
# ===========================================================================
def _fallback_context_and_message(job, room, tickets, tech_name, eta_minutes):
    guest = room.get("guest_name") or "the guest"
    tier = room.get("guest_loyalty_tier")
    occ = room.get("occupancy_status")
    bits = [f"{job['title']} reported in room {job['room_number']} ({job['priority']} priority)."]
    if occ == "occupied":
        who = guest + (f", a {tier} loyalty guest" if tier else "")
        bits.append(f"Room is occupied by {who}.")
    elif occ == "checkout":
        bits.append(f"{guest} is checking out at {_fmt_checkout(room.get('checkout_time'))}.")
    elif occ == "vacant":
        bits.append("Room is vacant — no guest to coordinate with.")
    if room.get("vip"):
        bits.append("VIP guest — notify before entering and keep disruption minimal.")
    if tickets:
        last = tickets[0]
        res = (last.get("resolution") or "unresolved").rstrip(".")
        bits.append(f"This room has {len(tickets)} prior ticket(s); most recent "
                    f"({last['date']}): {last['description'].rstrip('.')} → {res}.")
    message = "" if occ == "vacant" else (
        f"Hi {guest}, this is {tech_name} with {HOTEL_NAME} maintenance. I'm on my way "
        f"to room {job['room_number']} to look at the {job['title'].lower()} and should "
        f"arrive in about {eta_minutes} minutes. Thank you for your patience."
    )
    return {"context_summary": " ".join(bits), "message_draft": message}


def _fallback_resolution_and_closeout(job, room, chips, tech_notes, tickets):
    guest = room.get("guest_name") or "the guest"
    chip_text = ", ".join(chips) if chips else "no findings selected"
    parts = [f"{job['title']} in room {job['room_number']}: {chip_text}."]
    if tech_notes:
        parts.append(tech_notes.strip().rstrip(".") + ".")
    if tickets:
        parts.append(f"Note: {len(tickets)} prior ticket(s) on record for this room.")
    closeout = (f"Hi {guest}, {HOTEL_NAME} maintenance has finished in room "
                f"{job['room_number']}. Please let the front desk know if anything still "
                "needs attention. Thank you.")
    return {"resolution_summary": " ".join(parts), "closeout_message": closeout}


def _fallback_titles(description, job_type):
    d = " ".join((description or "").split()).rstrip(".")
    label = job_type.capitalize()
    primary = (d[:48].strip().capitalize()) if d else f"{label} issue"
    return [primary, f"{label} repair needed", f"Guest-reported {job_type} issue"]


_ESTIMATE_BASE = {"hvac": 25, "plumbing": 18, "electrical": 10, "general": 12}


def _fallback_estimate(job_type, repeat):
    minutes = _ESTIMATE_BASE.get(job_type, 15)
    if repeat:
        minutes += 10  # repeat issue — allow more time
    return f"~{minutes} min"


def _fallback_photo_note(job):
    return (f"Photo attached for {job['title'].lower()} in room {job['room_number']}. "
            "Add a description of what the photo shows.")


def _fallback_routing_summary(routing, is_vip, is_safety):
    lines = ["Supervisor will be notified."]
    if routing["front_desk"]:
        lines.append("Front desk will be looped in (VIP guest in room).")
    if routing["engineering_log"]:
        lines.append(f"Logged to the engineering log "
                     f"({'safety concern' if is_safety else 'repeat issue'}).")
    return " ".join(lines)


def _fallback_handoff_note(shift, s, escalation_count):
    lines = [
        f"Handoff from {shift.get('tech_name')} ({shift.get('shift_date')}).",
        f"Closed {s['completed']} of {s['total']} jobs; {s['escalated']} escalated; "
        f"{s['pending']} still open.",
    ]
    if s["open_items"]:
        lines.append("Still open: " + "; ".join(s["open_items"]) + ".")
    if escalation_count:
        lines.append(f"{escalation_count} escalation(s) raised — check with supervisor.")
    return " ".join(lines)
