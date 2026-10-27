#!/usr/bin/env python3
"""Atomic release metadata. This file never contains application secrets."""
import json, os, re, sys, tempfile
from pathlib import Path
command, filename, *args = sys.argv[1:]
p = Path(filename)
state = json.loads(p.read_text()) if p.exists() else {"history": []}
history = state["history"]
def save():
    fd, tmp = tempfile.mkstemp(dir=p.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
if command == "get":
    index = -1 if args[0] == "current" else -2
    if len(history) < abs(index): sys.exit(1)
    print(history[index][args[1]])
elif command == "commit":
    sha, image = args
    if not re.fullmatch(r"[0-9a-f]{40}", sha): sys.exit("Invalid release SHA")
    if not history or history[-1]["sha"] != sha:
        history.append({"sha": sha, "image": image})
    state["history"] = history[-10:]
    save()
elif command == "rollback":
    if len(history) < 2: sys.exit("No previous validated release")
    history.pop(); save()
else: sys.exit("Unknown state operation")
