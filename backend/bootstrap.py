"""Knock — startup bootstrap (run once before the web server boots).

Ensures the schema exists and seeds the demo shift only if the database is
empty. This is idempotent and safe across deploys:

  - Fresh/ephemeral disk (no Railway volume)  -> seeded on every deploy.
  - Volume-backed disk with existing data      -> left untouched.

Run as a single step (not per gunicorn worker) so concurrent workers never race
on the destructive reseed. See the Dockerfile CMD.
"""

from models import get_db, init_db


def main() -> None:
    init_db()  # create tables if they don't exist (non-destructive)

    conn = get_db()
    try:
        job_count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    finally:
        conn.close()

    if job_count == 0:
        import seed
        seed.seed()
        print("bootstrap: empty database — seeded fresh start-of-shift")
    else:
        print(f"bootstrap: database already populated ({job_count} jobs) — leaving as-is")


if __name__ == "__main__":
    main()
