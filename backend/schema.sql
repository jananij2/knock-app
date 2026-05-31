-- Knock — SQLite schema
-- Non-destructive (CREATE TABLE IF NOT EXISTS) so the running app can call
-- init_db() safely. seed.py drops everything first before re-applying this.

-- ---------------------------------------------------------------------------
-- Core tables (from the PRD data model)
-- ---------------------------------------------------------------------------

-- rooms: PMS-style room context. May be stale — tech corrections override.
CREATE TABLE IF NOT EXISTS rooms (
    room_number          TEXT PRIMARY KEY,
    floor                INTEGER NOT NULL,
    occupancy_status     TEXT NOT NULL CHECK (occupancy_status IN ('occupied', 'vacant', 'checkout', 'checkin')),
    guest_name           TEXT,
    guest_loyalty_tier   TEXT CHECK (guest_loyalty_tier IN ('standard', 'gold', 'diamond')), -- display only
    room_type            TEXT NOT NULL DEFAULT 'Standard'
                            CHECK (room_type IN ('Studio', 'Suite', 'Deluxe', 'Standard')), -- display only
    vip                  INTEGER NOT NULL DEFAULT 0, -- boolean: this room holds a VIP guest (drives behavior)
    checkout_time        TEXT,                       -- ISO 8601 datetime, NULL if vacant
    adjacent_vip         INTEGER NOT NULL DEFAULT 0, -- boolean: a neighbouring room holds a VIP
    noise_sensitivity_flag INTEGER NOT NULL DEFAULT 0, -- boolean
    housekeeping_status  TEXT CHECK (housekeeping_status IN ('clean', 'dirty', 'in_progress'))
);

-- jobs: the maintenance jobs dispatched to the tech this shift.
CREATE TABLE IF NOT EXISTS jobs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    room_number         TEXT NOT NULL REFERENCES rooms(room_number),
    floor               INTEGER NOT NULL,
    priority            TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'normal')),
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'in_progress', 'resolved', 'escalated')),
    dispatched_at       TEXT NOT NULL,              -- ISO 8601 datetime
    started_at          TEXT,                       -- set when tech taps "Start job"
    resolved_at         TEXT,                       -- set when job is closed
    job_type            TEXT NOT NULL CHECK (job_type IN ('hvac', 'plumbing', 'electrical', 'general')),
    source              TEXT NOT NULL DEFAULT 'dispatched'
                            CHECK (source IN ('dispatched', 'adhoc')), -- adhoc = tech self-logged
    findings            TEXT NOT NULL DEFAULT '[]', -- JSON array of selected chips
    tech_notes          TEXT,
    ai_context_summary  TEXT,                       -- cached Claude output (read-only feature)
    ai_resolution_summary TEXT,                     -- cached Claude output, confirmed by tech
    time_spent_seconds  INTEGER,                    -- active time on the job, set when closed/escalated
    ai_time_estimate    TEXT                        -- AI completion estimate for the home card, e.g. "~20 min"
);

-- tickets: prior maintenance history per room (repeat-issue detection).
CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT NOT NULL REFERENCES rooms(room_number),
    date        TEXT NOT NULL,                      -- ISO 8601 date
    description TEXT NOT NULL,
    resolution  TEXT,
    resolved    INTEGER NOT NULL DEFAULT 1          -- boolean
);

-- messages: guest <-> tech message thread, one per job.
-- Every outbound message is logged only after explicit tech confirmation.
CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            INTEGER NOT NULL REFERENCES jobs(id),
    direction         TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    content           TEXT NOT NULL,
    sent_at           TEXT NOT NULL,                -- ISO 8601 datetime
    confirmed_by_tech INTEGER NOT NULL DEFAULT 0    -- boolean
);

-- shift_log: one row per shift. ai_summary + handoff_note filled at end of shift.
CREATE TABLE IF NOT EXISTS shift_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_name    TEXT NOT NULL,
    shift_date   TEXT NOT NULL,                     -- ISO 8601 date
    shift_start  TEXT NOT NULL,                     -- "HH:MM"
    shift_end    TEXT NOT NULL,                     -- "HH:MM"
    ai_summary   TEXT,                              -- NULL until end-of-shift confirmed
    handoff_note TEXT                               -- NULL until end-of-shift confirmed
);

-- ---------------------------------------------------------------------------
-- Extra tables (implied by endpoints/flows, beyond the PRD's 5 — confirmed)
-- ---------------------------------------------------------------------------

-- push_subscriptions: browser Push API subscriptions (POST /api/push/subscribe).
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,                       -- subscription public key
    auth       TEXT NOT NULL,                       -- subscription auth secret
    created_at TEXT NOT NULL
);

-- escalations: detail behind an escalated job (POST /api/jobs/<id>/escalate).
-- Routing booleans capture who was notified and why (PRD escalation rules).
CREATE TABLE IF NOT EXISTS escalations (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id                   INTEGER NOT NULL REFERENCES jobs(id),
    reason_chips             TEXT NOT NULL DEFAULT '[]', -- JSON array of reason chips
    note                     TEXT,                        -- free-text note for supervisor
    ai_routing_summary       TEXT,                        -- Claude's "who gets notified and why"
    supervisor_notified      INTEGER NOT NULL DEFAULT 1,  -- always notified
    front_desk_notified      INTEGER NOT NULL DEFAULT 0,  -- VIP guest or active complaint
    engineering_log_notified INTEGER NOT NULL DEFAULT 0,  -- repeat issue or safety flag
    created_at               TEXT NOT NULL
);

-- protocol_skips: VIP soft-gate "proceed without notifying" events.
-- Friction + accountability mechanism — logged, supervisor alerted, never blocked.
CREATE TABLE IF NOT EXISTS protocol_skips (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id              INTEGER NOT NULL REFERENCES jobs(id),
    skip_type           TEXT NOT NULL DEFAULT 'vip_no_message',
    detail              TEXT,
    supervisor_notified INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL
);
