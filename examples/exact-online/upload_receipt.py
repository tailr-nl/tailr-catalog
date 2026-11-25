#!/usr/bin/env python3
"""Een bon naar Exact sturen via de API van Tailr (exact-online__upload_receipt).

Het bestand gaat rechtstreeks van schijf naar Tailr; een AI-agent die dit script draait,
krijgt alleen het antwoord te zien, nooit het bestand.

Gebruik:
  export TAILR_URL=https://jouw-tailr-adres        # zonder / aan het eind
  export TAILR_APP_KEY=tca_...                      # sleutel van een app met recht op upload_receipt
  python3 upload_receipt.py bon.jpg --note "gereedschap project X"
  python3 upload_receipt.py factuur.pdf --route document

Alleen de standaardbibliotheek. Een foto groter dan ~1,4 MB eerst verkleinen (jpg, ~1600 px).
"""
import argparse
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

MAX_BYTES = 1_400_000


def main() -> int:
    p = argparse.ArgumentParser(description="Stuur een bon naar Exact via Tailr")
    p.add_argument("file", type=pathlib.Path)
    p.add_argument("--note", help="Opmerking voor de boekhouder (max 500 tekens)")
    p.add_argument("--route", choices=["scan", "document"], default="scan")
    p.add_argument("--recipient-mailbox-id", help="Scanmailbox (zie list_mailboxes), als er meer dan één is")
    a = p.parse_args()

    url = os.environ.get("TAILR_URL", "").rstrip("/")
    key = os.environ.get("TAILR_APP_KEY", "")
    if not url or not key:
        print("Zet TAILR_URL en TAILR_APP_KEY in de omgeving.", file=sys.stderr)
        return 2
    data = a.file.read_bytes()
    if len(data) > MAX_BYTES:
        print(f"Bestand is {len(data) // 1000} kB; hoogstens {MAX_BYTES // 1000} kB. Verklein het eerst.", file=sys.stderr)
        return 2

    args = {"file_name": a.file.name, "file_base64": base64.b64encode(data).decode("ascii"), "route": a.route}
    if a.note:
        args["note"] = a.note
    if a.recipient_mailbox_id:
        args["recipient_mailbox_id"] = a.recipient_mailbox_id

    req = urllib.request.Request(
        f"{url}/api/v1/tools/exact-online__upload_receipt",
        data=json.dumps(args).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=150) as res:
            print(json.dumps(json.loads(res.read()), indent=2, ensure_ascii=False))
            return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:2000]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
