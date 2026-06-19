import io
import re
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
import pandas as pd
from database import get_db
from models.kline import Kline
from models.user import User
from routers.auth import get_current_user

router = APIRouter(prefix="/import", tags=["import"])

# ── 安全限制 ───────────────────────────────────────────────────────────────────
MAX_FILE_SIZE   = 20 * 1024 * 1024   # 20MB 上限，防止超大文件耗尽内存
MAX_ROWS        = 100_000            # 最多10万行，防止百万行DoS
ALLOWED_MARKETS = {"stock", "futures", "crypto"}
ALLOWED_INTERVALS = {"1m","5m","15m","30m","1h","4h","1d","1w"}
# symbol 只允许字母/数字/中文/连字符，最长30字符，防路径穿越和注入
SYMBOL_RE = re.compile(r'^[\w\u4e00-\u9fff\-]{1,30}$')

REQUIRED_COLS = ["time", "open", "high", "low", "close", "volume"]


def _validate_params(symbol: str, market: str, interval: str):
    """校验查询参数合法性"""
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(400, "品种代码只能包含字母、数字、中文、连字符，长度1-30")
    if market not in ALLOWED_MARKETS:
        raise HTTPException(400, f"market 必须是: {ALLOWED_MARKETS}")
    if interval not in ALLOWED_INTERVALS:
        raise HTTPException(400, f"interval 必须是: {ALLOWED_INTERVALS}")


def _try_read_csv(content: bytes) -> pd.DataFrame:
    """多编码尝试读取，自动定位真实表头行"""
    for enc in ("utf-8-sig", "gbk", "utf-8", "latin-1"):
        try:
            text = content.decode(enc)
        except UnicodeDecodeError:
            continue

        # 扫描前15行找表头
        raw = pd.read_csv(io.StringIO(text), header=None, nrows=15, dtype=str)
        header_row = 0
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row]
            if "time" in vals and "open" in vals and "close" in vals:
                header_row = i
                break

        df = pd.read_csv(
            io.StringIO(text),
            header=header_row,
            dtype=str,
            nrows=MAX_ROWS + 1,   # 多读1行用来检测是否超限
        )
        df.columns = [str(c).strip().lower() for c in df.columns]
        return df

    raise HTTPException(400, "CSV编码无法识别，请另存为 UTF-8 或 GBK 格式")


def _safe_float(val):
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except Exception:
        pass
    s = str(val).strip()
    if s in ("", "nan", "none", "null", "#value!", "#n/a", "#ref!", "#div/0!"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _safe_int(val):
    f = _safe_float(val)
    return int(f) if f is not None else None


@router.post("/csv")
async def import_csv(
    symbol: str,
    market: str,
    interval: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. 参数校验
    _validate_params(symbol, market, interval)

    # 2. 文件类型校验（MIME + 扩展名双重）
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(400, "只允许上传 .csv 文件")
    if file.content_type and file.content_type not in (
        "text/csv", "text/plain", "application/csv",
        "application/vnd.ms-excel", "application/octet-stream",
    ):
        raise HTTPException(400, f"文件类型不支持: {file.content_type}")

    # 3. 文件大小限制（先读，超限直接拒绝）
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"文件过大，上限 {MAX_FILE_SIZE//1024//1024}MB")

    # 4. 文件内容不能为空
    if len(content) < 10:
        raise HTTPException(400, "文件内容为空")

    # 5. 解析 CSV
    try:
        df = _try_read_csv(content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"CSV解析失败: {e}")

    # 6. 行数限制
    if len(df) > MAX_ROWS:
        raise HTTPException(400, f"数据行数超过上限 {MAX_ROWS} 行，请分批导入")

    # 7. 必填列检查
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise HTTPException(400, f"未找到必填列: {missing}，实际列名: {list(df.columns)[:10]}")

    # 8. 删除旧数据（只删当前用户对应的 symbol+interval）
    db.query(Kline).filter_by(symbol=symbol, interval=interval).delete()
    db.commit()

    # 9. 逐行解析入库
    batch, count, skipped = [], 0, 0
    for _, row in df.iterrows():
        t = _safe_int(row.get("time"))
        if t is None or t <= 0:
            skipped += 1; continue

        o = _safe_float(row.get("open"))
        h = _safe_float(row.get("high"))
        l = _safe_float(row.get("low"))
        c = _safe_float(row.get("close"))
        v = _safe_float(row.get("volume"))

        if any(x is None for x in [o, h, l, c, v]):
            skipped += 1; continue

        # 基本价格合理性校验
        if not (0 < l <= o and 0 < l <= c and h >= o and h >= c and h >= l):
            skipped += 1; continue

        batch.append(Kline(
            symbol=symbol, market=market, interval=interval,
            time=t, open=o, high=h, low=l, close=c, volume=v,
            amount=_safe_float(row.get("amount")),
            open_interest=_safe_float(row.get("open_interest")),
        ))

        if len(batch) >= 1000:
            db.bulk_save_objects(batch)
            db.commit()
            count += len(batch)
            batch = []

    if batch:
        db.bulk_save_objects(batch)
        db.commit()
        count += len(batch)

    if count == 0:
        raise HTTPException(400, f"没有导入任何有效数据，共跳过 {skipped} 行")

    return {
        "imported": count,
        "skipped":  skipped,
        "symbol":   symbol,
        "interval": interval,
        "message":  f"成功导入 {count} 根K线" + (f"，跳过 {skipped} 行无效数据" if skipped else ""),
    }
