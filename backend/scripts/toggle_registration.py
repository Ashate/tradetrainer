"""
手动开启/关闭用户注册功能（无需登录、无需管理员账号，直接操作数据库）。

用法（在 backend 容器内执行）：
    docker compose exec backend python scripts/toggle_registration.py on      # 开启注册
    docker compose exec backend python scripts/toggle_registration.py off     # 关闭注册
    docker compose exec backend python scripts/toggle_registration.py status  # 查看当前状态
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import SessionLocal
from services.system_settings import is_registration_enabled, set_registration_enabled


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("on", "off", "status"):
        print(__doc__)
        sys.exit(1)

    action = sys.argv[1]
    db = SessionLocal()
    try:
        if action == "status":
            enabled = is_registration_enabled(db)
        else:
            enabled = set_registration_enabled(db, action == "on")
        print(f"注册功能当前状态: {'开启' if enabled else '关闭'}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
