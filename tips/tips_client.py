#!/usr/bin/env python3
"""Pure-stdlib Tips client for local/server and remote Python agents.

On DevSpace host, discovers private write key in ~/.local/share/devspace/tips/credentials.json.
On any other machine, configure TIPS_API_URL and TIPS_WRITE_TOKEN environment variables.
"""

import argparse
import contextlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request


class TipsClient:
    def __init__(self, url=None, token=None, timeout=10):
        url = url or os.environ.get("TIPS_API_URL")
        token = token or os.environ.get("TIPS_WRITE_TOKEN")
        self.dispatch_token = None
        if not token:
            project_root = Path(__file__).resolve().parent.parent
            private_config = project_root / "var" / "config" / "config.json"
            local_config = {}
            if private_config.is_file():
                local_config = json.loads(private_config.read_text(encoding="utf-8"))
            private_state = os.environ.get("DEVSPACE_STATE_DIR") or local_config.get("stateDir") or str(project_root / "var" / "state")
            path = Path(private_state).expanduser() / "tips" / "credentials.json"
            if path.is_file():
                secrets = json.loads(path.read_text(encoding="utf-8"))
                token = secrets["writeToken"]
                self.dispatch_token = secrets.get("dispatchToken")
                url = url or f"http://127.0.0.1:{local_config.get('port',7676)}/tips/api"
        if not token or not url:
            raise ValueError("Configure TIPS_API_URL and TIPS_WRITE_TOKEN, or run on the DevSpace host")
        if not url.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
            raise ValueError("Tips API URL must be HTTPS, or localhost HTTP")
        self.url = url
        self.token = token
        self.timeout = timeout

    def _post(self, url, payload, dispatch=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
        if dispatch:
            if not self.dispatch_token:
                raise ValueError("Only local trusted agents can wake the full-access Codex controller")
            headers["X-Tips-Dispatch"] = self.dispatch_token
        request = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Tips HTTP {exc.code}: {exc.read(2000).decode('utf-8', 'replace')}") from exc

    def request(self, **payload):
        return self._post(self.url, payload, dispatch=bool(self.dispatch_token))

    def update(self, id, **fields):
        return self.request(action="update", id=id, **fields)

    def get(self, id):
        return self.request(action="get", id=id)

    def list(self):
        return self.request(action="list")

    def delete(self, id):
        return self.request(action="delete", id=id)

    def heartbeat(self, id):
        return self.request(action="heartbeat", id=id)

    def history(self, id, limit=100):
        return self.request(action="history", id=id, limit=limit)

    def mailbox(self, action="list", **fields):
        url = self.url.replace("/tips/api", "/tips/messages")
        if url == self.url:
            raise ValueError("TIPS_API_URL should end in /tips/api")
        payload = {"action": action, **fields}
        return self._post(url, payload, dispatch=bool(fields.get("wake")))

    def message(self, body, subject="Agent message", sender="agent", to="controller", wake=False, **fields):
        return self.mailbox("post", body=body, subject=subject, **{"from": sender},
                            to=to, wake=wake, **fields)

    @contextlib.contextmanager
    def track(self, id, title=None, **fields):
        """Automatically mark a Python block as running / completed / failed."""
        self.update(id, title=title or id, status="running", **fields)
        try:
            yield self
        except BaseException as exc:
            self.update(id, status="failed", message=f"{type(exc).__name__}: {str(exc)[:400]}")
            raise
        else:
            self.update(id, status="completed", progress=100)


def main():
    parser = argparse.ArgumentParser(description="Submit a JSON task update to Tips")
    parser.add_argument("command", choices=("json", "update", "get", "list", "delete"))
    parser.add_argument("task_id", nargs="?")
    parser.add_argument("payload", nargs="?", help="JSON object for update, or - to read stdin")
    args = parser.parse_args()
    client = TipsClient()
    if args.command == "json":
        payload = json.load(sys.stdin) if not args.task_id or args.task_id == "-" else json.loads(args.task_id)
        result = client.request(**payload)
    elif args.command == "update":
        if not args.task_id:
            parser.error("update requires task_id")
        payload = json.load(sys.stdin) if not args.payload or args.payload == "-" else json.loads(args.payload)
        result = client.update(args.task_id, **payload)
    elif args.command == "get":
        result = client.get(args.task_id)
    elif args.command == "delete":
        result = client.delete(args.task_id)
    else:
        result = client.list()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
