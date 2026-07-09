import io
import re
import sys
import os
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
import pandas as pd
from database import get_db
from models.kline import Kline
from models.user import User
from routers.auth import get_current_user

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from data_fetcher.aggregator import aggregate_all_targets
from data_fetcher.db_writer import upsert_klines

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

    # 8. 解析CSV行为标准kline字典列表（不再删除旧数据——改为按时间戳合并：
    #    已有的时间点更新，缺失的时间点补全，这样重新上传同一标的不会丢失原有数据）
    parsed_klines, skipped = [], 0
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

        parsed_klines.append({
            "time": t, "open": o, "high": h, "low": l, "close": c, "volume": v,
            "amount": _safe_float(row.get("amount")),
            "open_interest": _safe_float(row.get("open_interest")),
        })

    if not parsed_klines:
        raise HTTPException(400, f"没有导入任何有效数据，共跳过 {skipped} 行")

    # 9. 按时间戳合并写入：已有的时间点更新OHLCV(应对同一时间点数据被修正的情况)，
    #    缺失的时间点补全插入。标记source="manual"，使其不参与定时任务的自动增量更新，
    #    且前端标的列表会显示"手动"标识。
    write_result = upsert_klines(symbol, market, interval, parsed_klines, source="manual")
    count = write_result["inserted"] + write_result["updated"]

    # 10. 自动周期聚合：仅当上传的是 1m 或 5m 数据，且不是股票市场时才聚合
    #     （需求：股票市场不需要聚合，其他周期的手动上传也不需要聚合）
    agg_summary = {}
    if interval in ("1m", "5m") and market != "stock":
        try:
            uploaded_rows = (
                db.query(Kline)
                .filter(Kline.symbol == symbol, Kline.interval == interval)
                .order_by(Kline.time)
                .all()
            )
            uploaded_klines = [
                {"time": r.time, "open": r.open, "high": r.high, "low": r.low,
                 "close": r.close, "volume": r.volume, "amount": r.amount,
                 "open_interest": r.open_interest}
                for r in uploaded_rows
            ]
            aggregated = aggregate_all_targets(uploaded_klines, interval, market)
            for target_interval, klines in aggregated.items():
                result = upsert_klines(symbol, market, target_interval, klines, source="manual")
                agg_summary[target_interval] = result["inserted"] + result["updated"]
        except Exception as e:
            # 聚合失败不应该让整个导入请求报错——基础周期数据已经成功导入
            agg_summary = {"_error": f"聚合过程出错（基础数据已正常导入）: {e}"}

    agg_msg = ""
    if agg_summary and "_error" not in agg_summary:
        parts = [f"{k}:{v}根" for k, v in agg_summary.items()]
        agg_msg = f"，自动聚合生成 {', '.join(parts)}"

    merge_msg = f"新增{write_result['inserted']}根，更新{write_result['updated']}根"

    return {
        "imported": count,
        "inserted": write_result["inserted"],
        "updated":  write_result["updated"],
        "skipped":  skipped,
        "symbol":   symbol,
        "interval": interval,
        "source":   "manual",
        "aggregated": agg_summary,
        "message":  f"{merge_msg}" + (f"，跳过 {skipped} 行无效数据" if skipped else "") + agg_msg,
    }
