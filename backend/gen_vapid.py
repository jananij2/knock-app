"""Generate a VAPID keypair for Web Push (run once).

Writes two gitignored files next to this script:
  - vapid_private.pem  : EC P-256 private key (PEM) — used by pywebpush to sign
  - vapid.json         : { public_key, sub } — public_key is the base64url
                         application server key the browser passes to
                         pushManager.subscribe(); sub is the VAPID contact.

Re-running rotates the keys, which invalidates existing browser subscriptions
(they'd need to re-subscribe). Safe to run once at setup.
"""

import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

HERE = Path(__file__).resolve().parent
PRIVATE_PEM = HERE / "vapid_private.pem"
VAPID_JSON = HERE / "vapid.json"
CONTACT = "mailto:dispatch@knock.example"  # VAPID "sub" — a contact for the push service


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    PRIVATE_PEM.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )

    # applicationServerKey = base64url(uncompressed EC public point), no padding.
    raw_pub = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_key = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()

    VAPID_JSON.write_text(json.dumps({"public_key": public_key, "sub": CONTACT}, indent=2))
    print(f"Wrote {PRIVATE_PEM.name} and {VAPID_JSON.name}")
    print(f"public_key: {public_key}")


if __name__ == "__main__":
    main()
