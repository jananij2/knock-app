"""Knock — Web Push sender (pywebpush + VAPID).

Loads the VAPID keypair written by gen_vapid.py and sends a push to every
stored browser subscription. Dead subscriptions (404/410) are pruned.

Browser push only (per PRD). If the keys aren't present, send_to_all() is a
no-op that reports it — the rest of the app keeps working.
"""

import json
import logging
from pathlib import Path

from pywebpush import WebPushException, webpush

from models import get_db

log = logging.getLogger("knock.push")

HERE = Path(__file__).resolve().parent
PRIVATE_PEM = HERE / "vapid_private.pem"
VAPID_JSON = HERE / "vapid.json"


def _vapid():
    """Return (private_pem_path, public_key, sub) or None if not configured."""
    if not (PRIVATE_PEM.exists() and VAPID_JSON.exists()):
        return None
    meta = json.loads(VAPID_JSON.read_text())
    return str(PRIVATE_PEM), meta["public_key"], meta["sub"]


def public_key():
    v = _vapid()
    return v[1] if v else None


def send_to_all(payload: dict) -> dict:
    """Send `payload` (JSON) to every stored subscription. Returns a small report."""
    v = _vapid()
    if not v:
        log.warning("VAPID keys not configured — run gen_vapid.py; skipping push")
        return {"configured": False, "sent": 0, "pruned": 0}
    private_pem, _, sub = v

    conn = get_db()
    try:
        subs = conn.execute(
            "SELECT id, endpoint, p256dh, auth FROM push_subscriptions").fetchall()
        sent, pruned = 0, 0
        for s in subs:
            info = {"endpoint": s["endpoint"],
                    "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
            try:
                webpush(
                    subscription_info=info,
                    data=json.dumps(payload),
                    vapid_private_key=private_pem,
                    vapid_claims={"sub": sub},
                )
                sent += 1
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):  # subscription gone — prune it
                    conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (s["id"],))
                    pruned += 1
                else:
                    log.warning("push to %s failed: %s", s["endpoint"][:40], e)
        conn.commit()
    finally:
        conn.close()
    return {"configured": True, "sent": sent, "pruned": pruned}
