"""
The credentialed half of the COS checks, run on the VM.

It lives here and executes there. The layer pipes this file into the VM's
Python over ssh stdin, so nothing is written to the server and the credential
never leaves the one host that already holds it -- /etc/hualong/cos.env, which
backup-db.sh has sourced since 2026-08-18. Copying that key to a second machine
to answer a read-only question is a bad trade.

It prints one JSON object and nothing else. Never a secret: not on success, not
in an error path. The caller turns the JSON into findings.

The endpoint is the internal one, matching cos-selftest.py -- VM to COS in the
same region does not consume the instance's public traffic quota, and the
uplink is 5 Mbps.
"""

import json
import os
import sys
import datetime

out = {"ok": False, "checks": {}, "error": None}

try:
    from qcloud_cos import CosConfig, CosS3Client
    from qcloud_cos.cos_exception import CosServiceError

    bucket = os.environ["COS_BUCKET"]
    region = os.environ["COS_REGION"]
    client = CosS3Client(CosConfig(
        Region=region,
        SecretId=os.environ["COS_SECRET_ID"],
        SecretKey=os.environ["COS_SECRET_KEY"],
        Endpoint="cos-internal.%s.myqcloud.com" % region,
        Scheme="https",
    ))
    out["bucket"] = bucket

    def attempt(name, fn):
        """A check that cannot run records why. Absence is never success."""
        try:
            out["checks"][name] = {"ran": True, "value": fn()}
        except CosServiceError as e:
            out["checks"][name] = {"ran": False, "why": "%s %s" % (e.get_status_code(), e.get_error_code())}
        except Exception as e:  # noqa: BLE001 - the reason matters more than the type
            out["checks"][name] = {"ran": False, "why": type(e).__name__}

    def acl():
        grants = client.get_bucket_acl(Bucket=bucket).get("AccessControlList", {}).get("Grant", [])
        if isinstance(grants, dict):
            grants = [grants]
        public = [g for g in grants
                  if "AllUsers" in json.dumps(g) or "qcs::cam::anyone:anyone" in json.dumps(g)]
        return {"grants": len(grants), "publicGrants": len(public)}

    def encryption():
        rules = client.get_bucket_encryption(Bucket=bucket)
        return {"configured": bool(rules)}

    def cors():
        rules = client.get_bucket_cors(Bucket=bucket).get("CORSRule", [])
        if isinstance(rules, dict):
            rules = [rules]
        return {"rules": len(rules),
                "origins": sorted({o for r in rules for o in
                                   ([r.get("AllowedOrigin")] if isinstance(r.get("AllowedOrigin"), str)
                                    else r.get("AllowedOrigin", []))})[:8]}

    def objects():
        """
        Every page. Reading only the first would report the backup missing the
        moment the media outnumber it, and a truncated listing must never be
        mistaken for a whole one.
        """
        marker = ""
        total = 0
        dumps = []
        truncated = False
        while True:
            page = client.list_objects(Bucket=bucket, Marker=marker, MaxKeys=1000)
            contents = page.get("Contents", [])
            if isinstance(contents, dict):
                contents = [contents]
            for o in contents:
                total += 1
                key = o["Key"]
                if any(w in key.lower() for w in ("dump", "backup", ".sql")):
                    dumps.append({"key": key,
                                  "modified": o["LastModified"],
                                  "size": int(o["Size"])})
            if page.get("IsTruncated") == "true":
                marker = page.get("NextMarker") or (contents[-1]["Key"] if contents else "")
                if not marker:
                    truncated = True
                    break
            else:
                break
            if total > 20000:
                truncated = True
                break

        dumps.sort(key=lambda d: d["modified"])
        newest = dumps[-1] if dumps else None
        age_h = None
        if newest:
            when = datetime.datetime.fromisoformat(newest["modified"].replace("Z", "+00:00"))
            now = datetime.datetime.now(datetime.timezone.utc)
            age_h = round((now - when).total_seconds() / 3600, 1)
        return {"total": total, "truncated": truncated, "dumpCount": len(dumps),
                "newest": newest, "newestAgeHours": age_h}

    attempt("acl", acl)
    attempt("encryption", encryption)
    attempt("cors", cors)
    attempt("objects", objects)
    out["ok"] = True

except KeyError as e:
    out["error"] = "missing environment variable %s -- /etc/hualong/cos.env may have changed" % e
except Exception as e:  # noqa: BLE001
    out["error"] = "%s: %s" % (type(e).__name__, str(e)[:200])

json.dump(out, sys.stdout)
