-- TradeTrainer 数据库初始化
CREATE DATABASE IF NOT EXISTS tradetrainer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tradetrainer;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    hashed_password VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- K线数据表
CREATE TABLE IF NOT EXISTS klines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    market VARCHAR(20) NOT NULL,
    `interval` VARCHAR(10) NOT NULL,
    `time` BIGINT NOT NULL,
    open DOUBLE NOT NULL,
    high DOUBLE NOT NULL,
    low DOUBLE NOT NULL,
    close DOUBLE NOT NULL,
    volume DOUBLE NOT NULL,
    amount DOUBLE,
    open_interest DOUBLE,
    INDEX idx_symbol_interval_time (symbol, `interval`, `time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 训练Session表
CREATE TABLE IF NOT EXISTS training_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    market VARCHAR(20) NOT NULL,
    `interval` VARCHAR(10) NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    data_start_ts BIGINT NOT NULL,
    data_end_ts BIGINT,
    duration_sec INT,
    trade_count INT DEFAULT 0,
    total_pnl DOUBLE DEFAULT 0,
    win_count INT DEFAULT 0,
    loss_count INT DEFAULT 0,
    win_rate DOUBLE,
    avg_rr DOUBLE,
    max_drawdown DOUBLE,
    profit_factor DOUBLE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 交易记录表
CREATE TABLE IF NOT EXISTS trades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    direction VARCHAR(10) NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 1,
    entry_price DOUBLE NOT NULL,
    exit_price DOUBLE,
    entry_time BIGINT NOT NULL,
    exit_time BIGINT,
    sl_price DOUBLE,
    tp_price DOUBLE,
    exit_reason VARCHAR(20),
    pnl DOUBLE,
    pnl_pct DOUBLE,
    atr_at_entry DOUBLE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 案例库表
CREATE TABLE IF NOT EXISTS trade_cases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    trade_id INT,
    session_id INT,
    symbol VARCHAR(20) NOT NULL,
    case_type VARCHAR(20) NOT NULL,
    entry_screenshot VARCHAR(500),
    exit_screenshot VARCHAR(500),
    note TEXT,
    tags VARCHAR(200),
    pnl DOUBLE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 插入默认管理员账号 (密码: admin123)
-- INSERT IGNORE INTO users (username, email, hashed_password) VALUES (
--    'admin',
--    'admin@tradetrainer.local',
--    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewEp4OQ3GW0sGHOe'
-- );

-- 新增收益率字段（升级脚本，已有数据库执行此语句）
ALTER TABLE training_sessions ADD COLUMN pnl_pct DOUBLE DEFAULT NULL AFTER total_pnl;
