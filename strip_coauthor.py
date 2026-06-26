"""Rewrite git history to remove Cursor co-author trailers."""
import subprocess
import sys


def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True).strip()


def strip_coauthor(msg: str) -> str:
    lines = [
        line
        for line in msg.splitlines()
        if not line.strip().startswith("Co-authored-by: Cursor")
    ]
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    commits = run(["git", "rev-list", "--reverse", branch]).splitlines()
    if not commits:
        print("No commits found", file=sys.stderr)
        return 1

    new_head = None
    parent = None

    for commit in commits:
        tree = run(["git", "rev-parse", f"{commit}^{{tree}}"])
        msg = run(["git", "log", "-1", "--format=%B", commit])
        clean_msg = strip_coauthor(msg)

        cmd = ["git", "commit-tree", tree, "-m", clean_msg]
        if parent:
            cmd.extend(["-p", parent])
        new_commit = run(cmd)
        parent = new_commit
        new_head = new_commit
        print(f"{commit[:7]} -> {new_commit[:7]}")

    run(["git", "update-ref", f"refs/heads/{branch}", new_head])
    print(f"Updated {branch} -> {new_head[:7]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
