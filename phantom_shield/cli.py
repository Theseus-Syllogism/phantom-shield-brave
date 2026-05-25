"""phantom command-line interface.

Subcommands:
    phantom get URL [--persona NAME] [--header H] [--params K=V] ...
    phantom post URL [--persona NAME] [--data BODY | --json JSON_BODY]
    phantom head URL [--persona NAME]
    phantom rotate PERSONA          force rotate upstream
    phantom reset PERSONA           wipe cookies + reset rotation
    phantom log PERSONA [--since DUR] [--tail]
    phantom personas list
    phantom personas show NAME
    phantom personas new NAME [--profile P] [--region R] [...]
    phantom profiles list
    phantom profiles show VALUE
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

from phantom_shield.catalog import (
    PROFILES,
    REGIONS,
    RESOLUTIONS,
    find_profile,
    find_region,
)
from phantom_shield.persona import Persona, DEFAULT_PERSONA_DIR


def _parse_kv_list(items: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items or []:
        if ":" in item:
            k, _, v = item.partition(":")
        elif "=" in item:
            k, _, v = item.partition("=")
        else:
            raise SystemExit(f"could not parse header/param: {item!r} (expected K:V or K=V)")
        out[k.strip()] = v.strip()
    return out


def _load_persona(name: Optional[str]) -> Persona:
    if name:
        return Persona.load(name)
    # Anonymous request: a transient default persona, no log/cookie persistence.
    return Persona(name="_default")


def cmd_request(method: str, args) -> int:
    persona = _load_persona(args.persona)
    headers = _parse_kv_list(args.header)
    params = _parse_kv_list(args.params)

    from phantom_shield.session import Session  # lazy import - curl_cffi is heavy

    kwargs: dict = {"headers": headers}
    if params:
        kwargs["params"] = params
    if method == "POST":
        if args.json:
            kwargs["json"] = json.loads(args.json)
        elif args.data:
            kwargs["data"] = args.data

    with Session(persona, auto_rotate=args.auto_rotate) as s:
        try:
            r = s.request(method, args.url, **kwargs)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1

        if args.head_only or method == "HEAD":
            print(f"{r.status_code} {r.reason}")
            for k, v in r.headers.items():
                print(f"{k}: {v}")
        elif args.dump_headers:
            print(f"{r.status_code} {r.reason}")
            for k, v in r.headers.items():
                print(f"{k}: {v}")
            print()
            sys.stdout.write(r.text)
        else:
            sys.stdout.write(r.text)
            if not r.text.endswith("\n"):
                sys.stdout.write("\n")

        if s.last_signals:
            for sig in s.last_signals:
                print(
                    f"# blocked: {sig.detector} ({sig.reason}) status={sig.status}",
                    file=sys.stderr,
                )
            return 2
        return 0 if r.status_code < 400 else 1


def cmd_rotate(args) -> int:
    persona = Persona.load(args.persona)
    from phantom_shield.session import Session

    with Session(persona) as s:
        new = s.rotate_upstream()
        print(f"rotated {persona.name!r} upstream to: {new or '(direct)'}")
    return 0


def cmd_reset(args) -> int:
    persona = Persona.load(args.persona)
    from phantom_shield.session import Session

    with Session(persona) as s:
        s.reset()
        print(f"reset {persona.name!r}: cookies cleared, upstream rotation reset")
    return 0


def cmd_log(args) -> int:
    persona = Persona.load(args.persona)
    log_path = persona.log.get("path")
    if not log_path:
        print(f"persona {persona.name!r} has no log path configured", file=sys.stderr)
        return 1
    log_path = Path(log_path).expanduser()
    if not log_path.exists():
        print(f"no log yet at {log_path}", file=sys.stderr)
        return 0

    cutoff = None
    if args.since:
        cutoff = time.time() - _parse_duration(args.since)

    with log_path.open("r", encoding="utf-8") as fh:
        lines = fh.readlines()

    if args.tail:
        lines = lines[-args.tail:]

    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cutoff and entry.get("ts", 0) < cutoff:
            continue
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(entry["ts"]))
        blocked = " [BLOCKED]" if entry.get("blocked") else ""
        up = entry.get("upstream") or "(direct)"
        print(
            f"{ts}  {entry['method']:6} {entry['status']:>3}  "
            f"{entry['latency_ms']:>6.0f}ms  via={up}  {entry['url']}{blocked}"
        )
    return 0


def _parse_duration(s: str) -> float:
    """Parse '1h', '30m', '15s' to seconds."""
    if s.endswith("h"):
        return float(s[:-1]) * 3600
    if s.endswith("m"):
        return float(s[:-1]) * 60
    if s.endswith("s"):
        return float(s[:-1])
    return float(s)


def cmd_personas_list(args) -> int:
    d = DEFAULT_PERSONA_DIR
    if not d.exists():
        print(f"no personas at {d}")
        return 0
    names = sorted({p.stem for p in d.glob("*.yaml")} | {p.stem for p in d.glob("*.yml")})
    if not names:
        print(f"no personas at {d}")
        return 0
    for n in names:
        print(n)
    return 0


def cmd_personas_show(args) -> int:
    persona = Persona.load(args.name)
    import yaml as _yaml

    print(_yaml.safe_dump(persona.to_dict(), sort_keys=False, default_flow_style=False), end="")
    return 0


def cmd_personas_new(args) -> int:
    upstream: dict = {}
    if args.upstream:
        upstream = {"type": "pool", "servers": args.upstream, "rotation": args.rotation}
    elif args.tor:
        upstream = {"type": "tor"}
    persona = Persona(
        name=args.name,
        profile=args.profile,
        region=args.region,
        upstream=upstream,
        cookies={"path": f"~/.phantom/cookies/{args.name}.json", "persist": True},
        dns={"mode": "doh", "resolver": "cloudflare"} if args.doh else {},
        rate_limit={"per_minute": args.rate, "burst": max(1, args.rate // 6)} if args.rate else {},
        jitter_ms=args.jitter,
        on_block={
            "detectors": ["cloudflare", "akamai", "perimeterx", "recaptcha", "hcaptcha", "rate_limit"],
            "action": "rotate_upstream",
        },
        log={"path": f"~/.phantom/logs/{args.name}.jsonl", "enabled": True},
    )
    path = persona.save()
    print(f"wrote {path}")
    return 0


def cmd_profiles_list(args) -> int:
    for p in PROFILES:
        mobile = " mobile" if p.get("mobile") else ""
        print(f"{p['value']:25} {p['label']:30}{mobile}")
    return 0


def cmd_profiles_show(args) -> int:
    p = find_profile(args.value)
    if p["value"] != args.value:
        print(f"unknown profile {args.value!r}; closest match: {p['value']}", file=sys.stderr)
        return 1
    print(f"value:       {p['value']}")
    print(f"label:       {p['label']}")
    print(f"platform:    {p['platform']}{' (mobile)' if p.get('mobile') else ''}")
    print(f"user-agent:  {p['ua']}")
    print(f"caps:        {json.dumps(p['caps'])}")
    if p.get("brands"):
        print(f"sec-ch-ua:   {p['brands']}")
    print(f"description: {p.get('description', '')}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="phantom",
        description="TLS-fingerprint-aware HTTPS client (sibling to the Brave extension).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_request_args(sp):
        sp.add_argument("url")
        sp.add_argument("--persona", "-p", help="persona name (loaded from ~/.phantom/personas/)")
        sp.add_argument("--header", "-H", action="append", default=[], help="extra header (K:V)")
        sp.add_argument("--params", "-q", action="append", default=[], help="query param (K=V)")
        sp.add_argument("--auto-rotate", action="store_true", help="rotate upstream on detected block")
        sp.add_argument("--dump-headers", "-i", action="store_true", help="print response headers before body")
        sp.add_argument("--head-only", "-I", action="store_true", help="print only headers (forces HEAD)")

    sp_get = sub.add_parser("get", help="HTTP GET")
    add_request_args(sp_get)
    sp_get.set_defaults(func=lambda a: cmd_request("GET", a))

    sp_post = sub.add_parser("post", help="HTTP POST")
    add_request_args(sp_post)
    sp_post.add_argument("--data", "-d", help="raw request body")
    sp_post.add_argument("--json", help="JSON-encoded request body")
    sp_post.set_defaults(func=lambda a: cmd_request("POST", a))

    sp_head = sub.add_parser("head", help="HTTP HEAD")
    add_request_args(sp_head)
    sp_head.set_defaults(func=lambda a: cmd_request("HEAD", a))

    sp_rot = sub.add_parser("rotate", help="force-rotate a persona's upstream")
    sp_rot.add_argument("persona")
    sp_rot.set_defaults(func=cmd_rotate)

    sp_reset = sub.add_parser("reset", help="wipe a persona's cookies + reset rotation")
    sp_reset.add_argument("persona")
    sp_reset.set_defaults(func=cmd_reset)

    sp_log = sub.add_parser("log", help="view a persona's request log")
    sp_log.add_argument("persona")
    sp_log.add_argument("--since", help="only show entries newer than DURATION (e.g. 1h, 30m)")
    sp_log.add_argument("--tail", type=int, help="show only the last N lines")
    sp_log.set_defaults(func=cmd_log)

    sp_personas = sub.add_parser("personas", help="manage personas")
    sub_per = sp_personas.add_subparsers(dest="personas_cmd", required=True)

    sp_per_list = sub_per.add_parser("list", help="list known personas")
    sp_per_list.set_defaults(func=cmd_personas_list)

    sp_per_show = sub_per.add_parser("show", help="show a persona's config")
    sp_per_show.add_argument("name")
    sp_per_show.set_defaults(func=cmd_personas_show)

    sp_per_new = sub_per.add_parser("new", help="create a new persona file")
    sp_per_new.add_argument("name")
    sp_per_new.add_argument("--profile", default="chrome146")
    sp_per_new.add_argument("--region", default="us-east")
    sp_per_new.add_argument("--upstream", "-u", action="append", help="upstream proxy URL (repeatable)")
    sp_per_new.add_argument("--rotation", default="sticky-1h", help="rotation strategy")
    sp_per_new.add_argument("--tor", action="store_true", help="use local Tor as upstream")
    sp_per_new.add_argument("--doh", action="store_true", help="enable DoH resolution")
    sp_per_new.add_argument("--rate", type=int, default=0, help="rate limit per minute")
    sp_per_new.add_argument("--jitter", type=int, nargs=2, metavar=("MIN", "MAX"))
    sp_per_new.set_defaults(func=cmd_personas_new)

    sp_profiles = sub.add_parser("profiles", help="browse the TLS profile catalogue")
    sub_pro = sp_profiles.add_subparsers(dest="profiles_cmd", required=True)

    sp_pro_list = sub_pro.add_parser("list", help="list all profiles")
    sp_pro_list.set_defaults(func=cmd_profiles_list)

    sp_pro_show = sub_pro.add_parser("show", help="show a profile's details")
    sp_pro_show.add_argument("value")
    sp_pro_show.set_defaults(func=cmd_profiles_show)

    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
