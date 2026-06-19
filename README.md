# TradeTrainer — 专业交易训练平台

类似飞行模拟器的交易训练工具，通过回放历史K线训练交易直觉。

## 快速启动

```bash
# 1. 克隆 / 解压项目
cd tradetrainer

# 2. (可选) 修改 .env 中的密码和密钥
cp .env .env.local

# 3. 启动所有服务
docker compose up -d

# 4. 等待约 30 秒后访问
open http://localhost:8888
```

默认端口: **8888**  

---

## 项目结构

```
tradetrainer/
├── docker-compose.yml       # 编排文件
├── .env                     # 环境变量（密码/端口）
├── nginx/
│   └── nginx.conf           # 反向代理配置
├── mysql/
│   └── init.sql             # 数据库初始化
├── backend/                 # FastAPI 后端
│   ├── Dockerfile
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/              # SQLAlchemy 模型
│   ├── routers/             # API 路由
│   └── services/            # 业务逻辑（指标计算等）
└── frontend/                # React 前端
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx          # 主应用（含全部功能）
        └── api.js           # API 客户端
```

---

## 服务说明

| 服务       | 说明                   | 内部端口 |
|-----------|------------------------|---------|
| nginx     | 反向代理入口            | 8888    |
| frontend  | React + Vite 前端      | 3000    |
| backend   | FastAPI 后端           | 8000    |
| mysql     | MySQL 8.0 数据库       | 3306    |

所有请求通过 Nginx 统一入口:
- `http://host:8888/`        → 前端
- `http://host:8888/api/`    → 后端 API
- `http://host:8888/docs`    → Swagger 文档

---

## K线数据导入

### 方式一：Web 界面
点击右上角「导入数据」按钮，上传 CSV 文件。

### 方式二：API 接口
```bash
curl -X POST "http://localhost:8888/api/import/csv" \
  -H "Authorization: Bearer <token>" \
  -F "file=@BTC_4h.csv" \
  -F "symbol=BTC" \
  -F "market=crypto" \
  -F "interval=4h"
```

### CSV 格式
```
time,open,high,low,close,volume,amount,open_interest
1704067200000,45000,45500,44800,45200,1234,5.5e7,
1704081600000,45200,46000,45100,45800,2345,1.1e8,
```
- `time`: Unix 毫秒时间戳
- `open_interest`: 期货持仓量（可选）

---

## 常用命令

```bash
# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重启某个服务
docker compose restart backend

# 停止所有服务
docker compose down

# 停止并清除数据（谨慎）
docker compose down -v
```

---

## 生产部署注意

1. 修改 `.env` 中的 `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD`、`SECRET_KEY`
2. 如需修改端口，修改 `APP_PORT`
3. 如使用 BaoTa 面板，在面板配置反向代理将域名指向 `127.0.0.1:8888`

![演示图](img/Screenshot_2026_0613_110142.png)
![演示图](img/Screenshot_2026_0613_110058.png)
![演示图](img/Screenshot_2026_0613_110042.png)
