#!/usr/bin/env python3
"""Talk to the dev HA from the host, stdlib only (nothing gets installed on
raccoon). ./dev calls this; run it directly only when debugging ./dev.

    devtool.py onboard            first-run user dev/devpass1234 + saved token
    devtool.py token              a fresh access token on stdout
    devtool.py add                create the Alfie config entry
    devtool.py state ID STATE [JSON-attrs]   set any entity's state (fakes)
    devtool.py seed               Lukas's house entities, all in their good state
    devtool.py call DOMAIN.SERVICE [JSON]    call a service
    devtool.py get ID             print an entity's state + attributes

Fake entities set through /api/states are not backed by an integration, so
they vanish on restart: re-run `seed` after `./dev restart`.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

BASE = os.environ.get("ALFIE_DEV_URL", "http://localhost:8125")
CLIENT_ID = BASE + "/"
AUTH_FILE = os.path.join(os.path.dirname(__file__), "config", ".alfie-dev-auth.json")
USER, PASSWORD = "dev", "devpass1234"

# The entity ids the hard-coded M1 defaults watch (see docs/design.md), each
# with the state it has when nothing is wrong. Seeding these makes the dev HA
# look like Lukas's house to Alfie.
SEED = {
    "binary_sensor.scarfe_218j_drive_1_exceeded_max_bad_sectors": "off",
    "binary_sensor.scarfe_218j_drive_2_exceeded_max_bad_sectors": "off",
    "binary_sensor.scarfe_218j_drive_1_below_min_remaining_life": "off",
    "binary_sensor.scarfe_218j_drive_2_below_min_remaining_life": "off",
    "binary_sensor.scarfe_218j_security_status": "off",
    "sensor.fineoffset_wh51_0ee63f_moisture": ("48", {"unit_of_measurement": "%",
                                                     "friendly_name": "Monstera moisture"}),
    "sensor.fineoffset_wh51_0ee64d_moisture": ("52", {"unit_of_measurement": "%",
                                                     "friendly_name": "Ficus moisture"}),
    "binary_sensor.bathroom_motion_sensor_battery_low": "off",
    "binary_sensor.hallway_motion_sensor_battery_low": "off",
    "binary_sensor.hallway_closet_motion_sensor_battery_low": "off",
    "input_boolean.guest_mode": "off",
    "switch.global_sleep_switches": "off",
    "binary_sensor.living_room_motion_sensor_occupancy": "off",
    "binary_sensor.hallway_motion_sensor_occupancy": "off",
    "binary_sensor.hallway_closet_motion_sensor_occupancy": "off",
    "binary_sensor.bathroom_motion_sensor_occupancy": "off",
    "binary_sensor.bedroom_light_motion_sensor_occupancy": "off",
    "binary_sensor.dining_room_presence_motion_sensor_presence": "off",
}


def _req(method, path, body=None, token=None, form=False):
    headers = {}
    data = None
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: HTTP {e.code} {e.read().decode()[:300]}")
    return json.loads(raw) if raw else None


def _save(tokens):
    with open(AUTH_FILE, "w") as f:
        json.dump(tokens, f)
    os.chmod(AUTH_FILE, 0o600)


def token():
    """An access token, refreshed from the saved refresh token."""
    try:
        with open(AUTH_FILE) as f:
            saved = json.load(f)
    except FileNotFoundError:
        sys.exit("dev HA not onboarded: run ./dev onboard")
    t = _req("POST", "/auth/token", {"grant_type": "refresh_token", "client_id": CLIENT_ID,
                                     "refresh_token": saved["refresh_token"]}, form=True)
    return t["access_token"], saved["refresh_token"]


def onboard():
    status = _req("GET", "/api/onboarding")
    if all(s["done"] for s in status):
        print("already onboarded")
        return
    code = _req("POST", "/api/onboarding/users", {
        "client_id": CLIENT_ID, "name": "Dev", "username": USER,
        "password": PASSWORD, "language": "en"})["auth_code"]
    t = _req("POST", "/auth/token", {"grant_type": "authorization_code", "code": code,
                                     "client_id": CLIENT_ID}, form=True)
    _save({"refresh_token": t["refresh_token"]})
    tok = t["access_token"]
    _req("POST", "/api/onboarding/core_config", {}, tok)
    _req("POST", "/api/onboarding/analytics", {}, tok)
    _req("POST", "/api/onboarding/integration",
         {"client_id": CLIENT_ID, "redirect_uri": CLIENT_ID + "?auth_callback=1"}, tok)
    print(f"onboarded: {USER} / {PASSWORD}")


def add():
    tok, _ = token()
    for e in _req("GET", "/api/config/config_entries/entry", token=tok):
        if e["domain"] == "alfie":
            print("alfie entry exists:", e["entry_id"])
            return
    flow = _req("POST", "/api/config/config_entries/flow", {"handler": "alfie"}, tok)
    if flow.get("type") == "form":
        flow = _req("POST", f"/api/config/config_entries/flow/{flow['flow_id']}", {}, tok)
    print(flow.get("type"), flow.get("title") or flow.get("reason") or flow)


def set_state(entity_id, state, attrs=None):
    tok, _ = token()
    if attrs is None:
        # Keep existing attributes, so a toggle doesn't drop the unit.
        cur = _get_raw(entity_id, tok)
        attrs = cur["attributes"] if cur else {}
    _req("POST", f"/api/states/{entity_id}", {"state": state, "attributes": attrs}, tok)


def _get_raw(entity_id, tok):
    req = urllib.request.Request(BASE + f"/api/states/{entity_id}",
                                 headers={"Authorization": "Bearer " + tok})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "onboard":
        onboard()
    elif cmd == "token":
        tok, refresh = token()
        print(json.dumps({"access_token": tok, "refresh_token": refresh,
                          "client_id": CLIENT_ID, "url": BASE}))
    elif cmd == "add":
        add()
    elif cmd == "state":
        set_state(args[0], args[1], json.loads(args[2]) if len(args) > 2 else None)
    elif cmd == "seed":
        for eid, v in SEED.items():
            state, attrs = v if isinstance(v, tuple) else (v, {})
            set_state(eid, state, attrs)
        print(f"seeded {len(SEED)} entities")
    elif cmd == "call":
        tok, _ = token()
        domain, service = args[0].split(".", 1)
        body = json.loads(args[1]) if len(args) > 1 else {}
        _req("POST", f"/api/services/{domain}/{service}", body, tok)
    elif cmd == "get":
        tok, _ = token()
        print(json.dumps(_get_raw(args[0], tok), indent=2))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
