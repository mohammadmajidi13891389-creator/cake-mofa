const Database = require("better-sqlite3");

const db = new Database("cakemofa.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        customer_name TEXT NOT NULL,

        customer_phone TEXT NOT NULL,

        province TEXT,

        city TEXT,

        address TEXT,

        postal_code TEXT,

        notes TEXT,

        items TEXT NOT NULL,

        amount INTEGER NOT NULL,

        discount_percent INTEGER DEFAULT 0,

        status TEXT DEFAULT 'pending',

        authority TEXT,

        ref_id TEXT,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP

    )
`);

// اضافه کردن ستون‌ها به دیتابیس‌های قدیمی
try {
    db.exec(`ALTER TABLE orders ADD COLUMN authority TEXT`);
} catch (error) {
    // اگر ستون از قبل وجود داشته باشد، کاری نمی‌کنیم
}

try {
    db.exec(`ALTER TABLE orders ADD COLUMN ref_id TEXT`);
} catch (error) {
    // اگر ستون از قبل وجود داشته باشد، کاری نمی‌کنیم
}

module.exports = db;