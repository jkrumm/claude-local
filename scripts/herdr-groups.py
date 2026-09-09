#!/usr/bin/env python3
"""Group the herdr sidebar into labelled sections.

herdr has no folders. It has two primitives that add up to one:

  workspace.move_block      atomically reorders a set of spaces
  workspace.report_metadata attaches a display-only token to a space,
                            rendered by `$group` in [ui.sidebar.spaces].rows

Since "a row disappears when none of its tokens have a value", giving the token
to exactly one space per group turns that row into a section header and leaves
every other space untouched. config/herdr/groups.json is the declaration; this
script is the applier.

WHICH SPACE CARRIES THE HEADER IS THE WHOLE DESIGN, and the obvious answer is
wrong. herdr indents rows 2+ of an entry, so a header on a group's FIRST space
(as row 1) leaves that space's name indented while its siblings sit flush —
which reads as "only the first repo is in this group". Attaching the label to
the LAST space of the PREVIOUS group instead, as the entry's final row, puts it
in the same place on screen and makes every repo name row 1, so they all align.
The cost is that the first group cannot be labelled: nothing precedes it.

Order is persisted by herdr (session.json). Reported metadata is NOT — it is
re-applied by the space-groups plugin's startup hook after a server restart.

Stdlib only, and 3.9-compatible: the plugin startup hook may resolve a bare
/usr/bin/python3 rather than Homebrew's.
"""

import argparse
import json
import os
import socket
import sys


class NoServer(Exception):
    """No reachable herdr server — a missing socket path, or a stale one."""


HERE = os.path.dirname(os.path.abspath(__file__))
GROUPS_JSON = os.path.join(HERE, "..", "config", "herdr", "groups.json")
# HERDR_SOCKET_PATH is set in every pane and in the plugin runtime environment,
# and it is the only correct answer under a NAMED session, whose socket lives at
# ~/.config/herdr/sessions/<name>/ rather than the default path below.
SOCKET_PATH = os.environ.get(
    "HERDR_SOCKET_PATH", os.path.expanduser("~/.config/herdr/herdr.sock")
)
HEADER_PREFIX = "── "


class Herdr(object):
    """Newline-delimited JSON over the server socket.

    ONE CONNECTION PER REQUEST, and that is herdr's contract rather than a
    convenience here: only an `events.subscribe` connection stays open after
    its first response, so a second request written to the same socket dies
    with EPIPE. Measured, after exactly that traceback.
    """

    def __init__(self, path):
        self.path = path
        self.seq = 0

    def call(self, method, params):
        self.seq += 1
        req = {"id": "grp%d" % self.seq, "method": method, "params": params}
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(10)
        try:
            sock.connect(self.path)
            sock.sendall((json.dumps(req) + "\n").encode())
            line = sock.makefile("r").readline()
        except (OSError, socket.timeout) as err:
            # A STALE SOCKET FILE IS THE INTERESTING CASE, not a missing one: an
            # unclean herdr exit leaves the path behind, so the existence check in
            # main() passes and only connect() finds out. Same outcome either way.
            raise NoServer("%s: %s" % (self.path, err))
        finally:
            sock.close()
        if not line:
            raise RuntimeError("herdr closed the connection during %s" % method)
        resp = json.loads(line)
        if "error" in resp:
            raise RuntimeError("%s failed: %s" % (method, json.dumps(resp["error"])))
        return resp.get("result", {})

    def workspaces(self):
        return self.call("workspace.list", {})["workspaces"]


def is_variant(label, member):
    """A worktree-style variant of `member`, such as `dotfiles (feat-x)`.

    The separator test is what keeps `rollhook-action` and `dotfiles-private`
    from being swallowed as variants of `rollhook` and `dotfiles`: they are
    declared members in their own right, and plan() excludes every declared
    label here before asking.
    """
    return label.startswith(member) and not label[len(member):][:1].isalnum()


def plan(groups, fallback, workspaces):
    """Return [(header, [workspace, ...]), ...] covering every workspace once."""
    declared = set()
    for group in groups:
        declared.update(group["members"])
    remaining = list(workspaces)
    out = []
    for group in groups:
        picked = []
        for member in group["members"]:
            claimed = [w for w in remaining if w["label"] == member] + [
                w
                for w in remaining
                if w["label"] not in declared and is_variant(w["label"], member)
            ]
            for w in claimed:
                picked.append(w)
                remaining.remove(w)
        if picked:
            out.append((group["label"], picked))
    if remaining:
        out.append((fallback, remaining))
    return out


def apply_order(herdr, sections, current):
    """Move each section to the end in declared order; skip if already correct.

    `before_workspace_id: None` APPENDS — "omit the anchor to move the block to
    the end", per herdr's socket-api reference, and confirmed against the live
    session: 20 spaces came back from workspace.list in exactly the declared
    order. Were it move-to-front instead, every group would land reversed, so
    that is the one semantic worth re-checking if a herdr upgrade rearranges
    the sidebar.
    """
    wanted = [w["workspace_id"] for _, members in sections for w in members]
    if [w["workspace_id"] for w in current] == wanted:
        return False
    for _, members in sections:
        herdr.call(
            "workspace.move_block",
            {"workspace_ids": [w["workspace_id"] for w in members], "before_workspace_id": None},
        )
    return True


def headers_by_workspace(sections):
    """Map workspace_id -> header value, or None to clear.

    Each group's label lands on the space BEFORE its first member — see the
    module docstring. The first group is therefore unlabelled by construction.
    """
    flat = [w for _, members in sections for w in members]
    labels = {}
    index = 0
    for position, (header, members) in enumerate(sections):
        if position:
            labels[flat[index - 1]["workspace_id"]] = HEADER_PREFIX + header
        index += len(members)
    return dict((w["workspace_id"], labels.get(w["workspace_id"])) for w in flat)


def apply_headers(herdr, sections, source, token, clear_all=False):
    for workspace_id, value in headers_by_workspace(sections).items():
        herdr.call(
            "workspace.report_metadata",
            {
                "workspace_id": workspace_id,
                "source": source,
                "tokens": {token: None if clear_all else value},
            },
        )


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", nargs="?", default="apply", choices=["apply", "check", "clear"])
    args = ap.parse_args()

    with open(GROUPS_JSON) as fh:
        config = json.load(fh)
    source = config["source"]
    token = config["token"]

    herdr = Herdr(SOCKET_PATH)
    try:
        current = herdr.workspaces()
    except NoServer as err:
        # Not an error: the MacBook is a thin client and usually runs no server,
        # and this also runs from `make setup`. Say so and exit clean.
        sys.stderr.write("no herdr server at %s — nothing to group\n" % err)
        return 0
    sections = plan(config["groups"], config["fallback"], current)

    if args.mode == "check":
        for header, members in sections:
            print(HEADER_PREFIX + header)
            for w in members:
                print("    %s" % w["label"])
        return 0

    if args.mode == "clear":
        apply_headers(herdr, sections, source, token, clear_all=True)
        print("cleared %s tokens on %d spaces" % (token, len(current)))
        return 0

    reordered = apply_order(herdr, sections, current)
    apply_headers(herdr, sections, source, token)
    print(
        "%d spaces in %d groups%s"
        % (len(current), len(sections), "" if reordered else " (order already correct)")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
