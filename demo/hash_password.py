"""Print a bcrypt hash for ADMIN_PASSWORD_HASH.

Read the password from ADMIN_PASSWORD, or prompt for it. The password is
not printed and is not written to a file.

    ADMIN_PASSWORD='choose-one' python demo/hash_password.py
"""

from __future__ import annotations

import getpass
import os
import sys

import bcrypt


def main() -> int:
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not password:
        password = getpass.getpass("Password: ")
    if not password:
        print("No password given.", file=sys.stderr)
        return 1
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")
    print(hashed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
