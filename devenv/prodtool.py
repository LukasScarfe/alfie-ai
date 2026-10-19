"""Production HA (192.168.1.217) for `./dev prod ...`: REST and a stdlib
WebSocket client (raccoon has no websocket library). The token is read from
/mnt/homeassistant/.env and never printed.

  python3 devenv/prodtool.py ws TYPE [json]   one WebSocket command, result as JSON
  python3 devenv/prodtool.py get ENTITY       an entity's state as JSON
  python3 devenv/prodtool.py deploy           HACS fetches the pushed commit, installs it, HA restarts
"""

import base64
import json
import os
import re
import socket
import struct
import sys
import time
import urllib.request

HOST, PORT = "192.168.1.217", 8123
BASE = f"http://{HOST}:{PORT}"
REPO = "LukasScarfe/alfie-ai"
UPDATE = "update.alfie_update"


def _token():
    with open("/mnt/homeassistant/.env") as f:
        m = re.search(r"^HA_TOKEN=(.*)$", f.read(), re.M)
    return m.group(1).strip().strip("\"'")


def rest(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {_token()}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode()
    return json.loads(text) if text else None


class WS:
    def __init__(self):
        self.s = socket.create_connection((HOST, PORT), timeout=120)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /api/websocket HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n"
                        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.s.recv(1)
        self.buf, self.id = b"", 0
        assert self.recv()["type"] == "auth_required"
        self.send({"type": "auth", "access_token": _token()})
        if self.recv()["type"] != "auth_ok":
            raise SystemExit("auth failed")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        data = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            data += self._read(n)
            if b0 & 0x80:
                return json.loads(data)

    def send(self, msg):
        data, mask = json.dumps(msg).encode(), os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else
                                bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else
                                bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def call(self, type_, **fields):
        self.id += 1
        self.send({"id": self.id, "type": type_, **fields})
        while True:
            r = self.recv()
            if r.get("id") == self.id and r.get("type") == "result":
                if not r["success"]:
                    raise SystemExit(f"{type_}: {r['error']}")
                return r["result"]


def _wait_up(timeout=300):
    time.sleep(10)
    end = time.time() + timeout
    while time.time() < end:
        try:
            if rest("GET", "/api/states/" + UPDATE):
                return
        except Exception:
            pass
        time.sleep(5)
    raise SystemExit("HA did not come back")


def deploy():
    ws = WS()
    repo = next(r for r in ws.call("hacs/repositories/list")
                if r["full_name"].lower() == REPO.lower())
    ws.call("hacs/repository/refresh", repository=str(repo["id"]))
    rest("POST", "/api/services/homeassistant/update_entity", {"entity_id": UPDATE})
    time.sleep(3)
    st = rest("GET", "/api/states/" + UPDATE)["attributes"]
    print(f"installed {st['installed_version']}, latest {st['latest_version']}")
    if st["installed_version"] == st["latest_version"]:
        raise SystemExit("nothing new (pushed?)")
    rest("POST", "/api/services/update/install", {"entity_id": UPDATE})
    print("installed; restarting HA")
    try:
        rest("POST", "/api/services/homeassistant/restart", {})
    except Exception:
        pass
    _wait_up()
    st = rest("GET", "/api/states/" + UPDATE)["attributes"]
    print(f"HA is back with {st['installed_version']}")


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "ws":
        print(json.dumps(WS().call(argv[1], **(json.loads(argv[2]) if len(argv) > 2 else {})), indent=1))
    elif cmd == "get":
        print(json.dumps(rest("GET", "/api/states/" + argv[1]), indent=1))
    elif cmd == "deploy":
        deploy()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
