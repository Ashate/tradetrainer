"""
系统设置读写辅助：基于 system_settings 表的简单 key-value 存取。
目前用于「是否开放注册」开关，后续可扩展其他全局配置项。
"""
from sqlalchemy.orm import Session
from models.system_setting import SystemSetting

REGISTRATION_ENABLED_KEY = "registration_enabled"


def get_bool(db: Session, key: str, default: bool = True) -> bool:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row is None:
        return default
    return row.value == "1"


def set_bool(db: Session, key: str, value: bool):
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row is None:
        row = SystemSetting(key=key, value="1" if value else "0")
        db.add(row)
    else:
        row.value = "1" if value else "0"
    db.commit()
    return value


def is_registration_enabled(db: Session) -> bool:
    return get_bool(db, REGISTRATION_ENABLED_KEY, default=True)


def set_registration_enabled(db: Session, value: bool) -> bool:
    return set_bool(db, REGISTRATION_ENABLED_KEY, value)
