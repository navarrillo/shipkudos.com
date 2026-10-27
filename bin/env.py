#!/usr/bin/env python3
"""Validate and emit dotenv values without shell evaluation."""
import re, shlex, sys
mode, filename = sys.argv[1:]
items = []
for raw in open(filename):
    line = raw.strip()
    if not line or line.startswith('#'): continue
    if line.startswith('export '): line = line[7:]
    key, sep, value = line.partition('=')
    if not sep or not re.fullmatch(r'[A-Z_][A-Z0-9_]*', key.strip()): raise SystemExit('Invalid dotenv key')
    values = shlex.split(value, comments=True)
    if len(values) > 1: raise SystemExit('Quote dotenv values containing spaces')
    items.append((key.strip(), values[0] if values else ''))
if mode == 'emit':
    for key, value in items:
        sys.stdout.buffer.write(key.encode()+b'\0'+value.encode()+b'\0')
elif mode != 'validate': raise SystemExit('Invalid dotenv parser operation')
