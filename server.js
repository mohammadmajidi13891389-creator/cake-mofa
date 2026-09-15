require("dotenv").config();

const express = require("express");
const path = require("path");
const db = require("./database");

const app = express();

const PORT = process.env.PORT || 10000;

const ZARINPAL_REQUEST_URL =
    "https://payment.zarinpal.com/pg/v4/payment/request.json";

const ZARINPAL_VERIFY_URL =
    "https://payment.zarinpal.com/pg/v4/payment/verify.json";

const ZARINPAL_STARTPAY_URL =
    "https://payment.zarinpal.com/pg/StartPay/";

const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ===============================
// تنظیمات
// ===============================

app.use(express.json());

// نمایش فایل‌های سایت
app.use(express.static(__dirname));


// ===============================
// تست سرور
// ===============================

app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "cakemofa server is working!"
    });
});


// ===============================
// ثبت سفارش
// ===============================

async function requestZarinpalPayment({
    amount,
    description,
    callbackUrl,
    mobile
}) {
    if (!MERCHANT_ID || MERCHANT_ID === "YOUR_MERCHANT_ID") {
        throw new Error("ZARINPAL_MERCHANT_ID تنظیم نشده است.");
    }

    const response = await fetch(ZARINPAL_REQUEST_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            merchant_id: MERCHANT_ID,

            // زرین‌پال مبلغ را به ریال دریافت می‌کند
            amount: amount * 10,

            description,
            callback_url: callbackUrl,

            metadata: {
                mobile: mobile || ""
            }
        })
    });

    const data = await response.json();

    if (!response.ok || !data.data || !data.data.authority) {
        console.error("Zarinpal request error:", data);

        throw new Error(
            data.errors?.message ||
            "دریافت درگاه پرداخت از زرین‌پال ناموفق بود."
        );
    }

    return data.data;
}


app.post("/api/orders", async (req, res) => {
    try {
        const {
            customer_name,
            phone,
            province,
            city,
            address,
            postal_code,
            notes,
            items,
            total,
            discount_percent
        } = req.body;

        // بررسی اطلاعات ضروری
        if (
            !customer_name ||
            !phone ||
            !address ||
            !items ||
            total === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "لطفاً اطلاعات ضروری سفارش را کامل کنید."
            });
        }

        // بررسی سبد خرید
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: "سبد خرید خالی است."
            });
        }

        // بررسی مبلغ
        const amount = Number(total);

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: "مبلغ سفارش نامعتبر است."
            });
        }

        const discount = Number(discount_percent || 0);

        // ابتدا سفارش را pending ذخیره می‌کنیم
        const result = db.prepare(`
            INSERT INTO orders (
                customer_name,
                customer_phone,
                province,
                city,
                address,
                postal_code,
                notes,
                items,
                amount,
                discount_percent,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            customer_name,
            phone,
            province || "",
            city || "",
            address,
            postal_code || "",
            notes || "",
            JSON.stringify(items),
            amount,
            discount,
            "pending"
        );

        const orderId = result.lastInsertRowid;

        // آدرس بازگشت از زرین‌پال
        const callbackUrl =
            `${BASE_URL}/api/payment/callback?order_id=${orderId}`;

        // درخواست ساخت تراکنش در زرین‌پال
        const payment = await requestZarinpalPayment({
            amount: amount,
            description: `پرداخت سفارش شماره ${orderId} در cakemofa`,
            callbackUrl: callbackUrl,
            mobile: phone
        });

        const authority = payment.authority;

        // ذخیره Authority در سفارش
        db.prepare(`
            UPDATE orders
            SET authority = ?
            WHERE id = ?
        `).run(authority, orderId);

        const paymentUrl =
            `${ZARINPAL_STARTPAY_URL}${authority}`;

        // ارسال لینک پرداخت به فرانت
        res.status(201).json({
            success: true,
            message: "درگاه پرداخت آماده شد.",
            order_id: orderId,
            authority: authority,
            payment_url: paymentUrl
        });

    } catch (error) {
        console.error("Order / Payment error:", error);

        res.status(500).json({
            success: false,
            message: error.message || "خطایی در ایجاد پرداخت رخ داد."
        });
    }
});

// ===============================
// دریافت تمام سفارش‌ها برای ادمین
// ===============================

app.get("/api/orders", (req, res) => {

    try {

        const orders = db.prepare(`
            SELECT *
            FROM orders
            ORDER BY id DESC
        `).all();


        const formattedOrders = orders.map(order => {

            let items = [];

            try {

                items = JSON.parse(order.items);

            } catch {

                items = [];

            }


            return {

                id: order.id,

                customer: {

                    name: order.customer_name,

                    phone: order.customer_phone,

                    province: order.province,

                    city: order.city,

                    address: order.address,

                    postalCode: order.postal_code,

                    notes: order.notes

                },

                items: items,

                amount: order.amount,

                discountPercent: order.discount_percent,

                status: order.status,

                createdAt: order.created_at

            };

        });


        res.json(formattedOrders);


    } catch (error) {

        console.error("Get orders error:", error);

        res.status(500).json({

            success: false,

            message: "دریافت سفارش‌ها انجام نشد."

        });

    }

});


// ===============================
// دریافت یک سفارش
// ===============================

app.get("/api/orders/:id", (req, res) => {

    try {

        const id = Number(req.params.id);


        if (!Number.isInteger(id)) {

            return res.status(400).json({

                success: false,

                message: "شماره سفارش نامعتبر است."

            });

        }


        const order = db.prepare(`
            SELECT *
            FROM orders
            WHERE id = ?
        `).get(id);


        if (!order) {

            return res.status(404).json({

                success: false,

                message: "سفارش پیدا نشد."

            });

        }


        let items = [];

        try {

            items = JSON.parse(order.items);

        } catch {

            items = [];

        }


        res.json({

            success: true,

            order: {

                id: order.id,

                customer: {

                    name: order.customer_name,

                    phone: order.customer_phone,

                    province: order.province,

                    city: order.city,

                    address: order.address,

                    postalCode: order.postal_code,

                    notes: order.notes

                },

                items: items,

                amount: order.amount,

                discountPercent: order.discount_percent,

                status: order.status,

                createdAt: order.created_at

            }

        });


    } catch (error) {

        console.error("Get order error:", error);

        res.status(500).json({

            success: false,

            message: "خطایی رخ داد."

        });

    }

});


// ===============================
// تغییر وضعیت سفارش
// ===============================

app.patch("/api/orders/:id/status", (req, res) => {

    try {

        const id = Number(req.params.id);

        const { status } = req.body;


        const allowedStatuses = [
            "pending",
            "paid",
            "failed",
            "processing",
            "completed",
            "canceled"
        ];


        if (!allowedStatuses.includes(status)) {

            return res.status(400).json({

                success: false,

                message: "وضعیت سفارش نامعتبر است."

            });

        }


        const result = db.prepare(`
            UPDATE orders
            SET status = ?
            WHERE id = ?
        `).run(status, id);


        if (result.changes === 0) {

            return res.status(404).json({

                success: false,

                message: "سفارش پیدا نشد."

            });

        }


        res.json({

            success: true,

            message: "وضعیت سفارش تغییر کرد."

        });


    } catch (error) {

        console.error("Status update error:", error);

        res.status(500).json({

            success: false,

            message: "تغییر وضعیت انجام نشد."

        });

    }

});


// ===============================
// اجرای سرور
// ===============================

app.get("/health", (req, res) => {
    res.status(200).send("cakemofa is alive!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});