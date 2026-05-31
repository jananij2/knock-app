"""Knock — SQLite database access.

Raw sqlite3 (no ORM), per project decision. This module owns the connection
helper and schema initialisation; Flask and seed.py both import from here.
"""

import sqlite3
from pathlib import Path

# dispatch.db lives next to this file, in backend/.
BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = BACKEND_DIR / "dispatch.db"
SCHEMA_PATH = BACKEND_DIR / "schema.sql"


def get_db() -> sqlite3.Connection:
    """Open a connection with dict-like rows and foreign keys enforced."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row          # rows accessible by column name
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection | None = None) -> None:
    """Create tables if they don't exist (non-destructive).

    Pass an existing connection to reuse it; otherwise one is opened, used,
    and closed.
    """
    own_conn = conn is None
    if own_conn:
        conn = get_db()
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        conn.commit()
    finally:
        if own_conn:
            conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Initialised schema at {DB_PATH}")
