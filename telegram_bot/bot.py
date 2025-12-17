import os
import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime
import aiohttp

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from telegram.constants import ChatAction

import sqlite3
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TG_TOKEN = os.getenv('TELEGRAM_TOKEN')
YANDEX_API_KEY = os.getenv('YANDEX_API_KEY')
YANDEX_FOLDER_ID = os.getenv('YANDEX_FOLDER_ID')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Database initialization
def init_db():
    db = sqlite3.connect('labelspy_tg.db')
    cursor = db.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT,
            product_name TEXT,
            composition TEXT,
            verdict TEXT,
            risk_level TEXT,
            json_result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    db.commit()
    db.close()

init_db()

async def ocr_recognize(photo_path: str) -> str:
    """Recognize text from image using Yandex Vision API"""
    try:
        with open(photo_path, 'rb') as f:
            image_data = f.read()
        
        headers = {
            'Content-Type': 'image/jpeg',
        }
        params = {
            'folder_id': YANDEX_FOLDER_ID,
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze',
                headers=headers,
                params=params,
                json={
                    'folder_id': YANDEX_FOLDER_ID,
                    'analyze_specs': [{
                        'content': image_data.hex(),
                        'features': [{'type': 'TEXT_DETECTION', 'text_detection_config': {'language_codes': ['ru', 'en']}}]
                    }]
                },
                auth=aiohttp.BasicAuth('', YANDEX_API_KEY)
            ) as resp:
                result = await resp.json()
                if resp.status == 200:
                    text = ''
                    for result_item in result.get('results', []):
                        for block in result_item.get('textDetection', {}).get('pages', []):
                            for line in block.get('blocks', []):
                                for word in line.get('lines', []):
                                    for symbol in word.get('words', []):
                                        text += symbol.get('text', '')
                    return text
    except Exception as e:
        logger.error(f'OCR error: {e}')
    return None

async def analyze_with_gemini(text: str, mode: str = 'analyze') -> dict:
    """Analyze product composition with Gemini AI"""
    if mode == 'recipes':
        prompt = f"""Based on this product, suggest 3 creative recipes as JSON only:
{{"recipes": [{{"name": "name", "type": "cocktail|dish|beverage", "description": "desc", "ingredients": [], "steps": []}}]}}

Product: {text}"""
    else:
        prompt = f"""Analyze this product composition. Return JSON only:
{{"productName": "name", "verdict": "verdict", "riskLevel": "safe|moderate|high", "highlights": ["E-code"], "allergens": [], "features": [], "advice": "tip"}}

Composition: {text}"""
    
    try:
        async with aiohttp.ClientSession() as session:
            url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}'
            async with session.post(
                url,
                json={
                    'contents': [{'parts': [{'text': prompt}]}],
                    'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 2048}
                }
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    content = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                    # Extract JSON
                    import re
                    json_match = re.search(r'\{[\s\S]*\}', content)
                    if json_match:
                        return json.loads(json_match.group())
    except Exception as e:
        logger.error(f'Gemini error: {e}')
    return None

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    welcome_text = f"""👋 Привет, {user.first_name}!

Я **LabelSpy Bot** — анализирую упаковки продуктов за секунды!

🎯 Что я могу:
• 📷 Распознавать состав по фото (OCR)
• 🧪 Анализировать ингредиенты и E-коды
• ⚠️ Выдавать вердикт о безопасности
• 🍽️ Предлагать рецепты
• 💾 Сохранять историю анализов

📝 Просто загрузи фото этикетки и я расскажу всё!
"""
    await update.message.reply_text(welcome_text)

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    help_text = """📖 **Справка:**

/start — начать
/help — эта справка
/history — просмотреть историю анализов
/clear — удалить историю

📸 **Как использовать:**
1. Отправь фото этикетки
2. Бот распознает текст
3. Нажми "Анализировать"
4. Получи полный отчет!
"""
    await update.message.reply_text(help_text)

async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    message = update.message
    
    try:
        # Show typing indicator
        await update.message.chat.send_action(ChatAction.TYPING)
        
        # Download photo
        photo = message.photo[-1]
        file = await context.bot.get_file(photo.file_id)
        photo_path = f'/tmp/{user.id}_{datetime.now().timestamp()}.jpg'
        await file.download_to_drive(photo_path)
        
        # Recognize text
        await message.reply_text('🔍 Распознаю текст...')
        composition_text = await ocr_recognize(photo_path)
        
        if not composition_text:
            await message.reply_text('❌ Не удалось распознать текст. Попробуй еще раз.')
            os.remove(photo_path)
            return
        
        # Store in context for later use
        context.user_data['last_composition'] = composition_text
        context.user_data['last_photo_path'] = photo_path
        
        # Show composition preview
        preview = composition_text[:200] + '...' if len(composition_text) > 200 else composition_text
        
        keyboard = [
            [InlineKeyboardButton('✅ Анализировать', callback_data='analyze')],
            [InlineKeyboardButton('📝 Отредактировать', callback_data='edit')],
            [InlineKeyboardButton('❌ Отмена', callback_data='cancel')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await message.reply_text(f"""📄 **Распознанный текст:**

```
{preview}
```

Что дальше?""", reply_markup=reply_markup)
        
    except Exception as e:
        logger.error(f'Photo handling error: {e}')
        await message.reply_text(f'❌ Ошибка: {str(e)}')

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    if query.data == 'analyze':
        composition = context.user_data.get('last_composition')
        if not composition:
            await query.edit_message_text('❌ Текст не найден')
            return
        
        await query.edit_message_text('🤖 Анализирую с Gemini...')
        
        # Analyze
        analysis = await analyze_with_gemini(composition)
        if not analysis:
            await query.edit_message_text('❌ Ошибка анализа')
            return
        
        # Save to DB
        user_id = query.from_user.id
        username = query.from_user.username or 'unknown'
        db = sqlite3.connect('labelspy_tg.db')
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO analyses (user_id, username, product_name, composition, verdict, risk_level, json_result)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            user_id,
            username,
            analysis.get('productName', '?'),
            composition[:500],
            analysis.get('verdict', '?'),
            analysis.get('riskLevel', '?'),
            json.dumps(analysis)
        ))
        db.commit()
        db.close()
        
        # Format response
        risk_emoji = {'safe': '✅', 'moderate': '⚠️', 'high': '🔴'}.get(analysis.get('riskLevel'), '❓')
        
        response = f"""**{risk_emoji} {analysis.get('productName', 'Продукт')}**

**Вердикт:** {analysis.get('verdict', '?')}

**E-коды:** {', '.join(analysis.get('highlights', [])) or 'не найдены'}

**Аллергены:** {', '.join(analysis.get('allergens', [])) or 'не найдены'}

**Особенности:**
{chr(10).join(f"• {f}" for f in analysis.get('features', []))}

💡 **Совет:** {analysis.get('advice', '?')}
"""
        
        keyboard = [
            [InlineKeyboardButton('🍽️ Рецепты', callback_data='recipes')],
            [InlineKeyboardButton('📸 Новая фото', callback_data='cancel')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await query.edit_message_text(response, reply_markup=reply_markup, parse_mode='markdown')
        context.user_data['last_analysis'] = analysis
        
    elif query.data == 'recipes':
        await query.edit_message_text('👨‍🍳 Генерирую рецепты...')
        
        composition = context.user_data.get('last_composition')
        recipes = await analyze_with_gemini(composition, 'recipes')
        
        if not recipes or not recipes.get('recipes'):
            await query.edit_message_text('❌ Не удалось получить рецепты')
            return
        
        response = '🍽️ **Рецепты:**\n\n'
        for i, recipe in enumerate(recipes.get('recipes', [])[:3], 1):
            response += f"""**{i}. {recipe.get('name', '?')}** `{recipe.get('type', '?')}`
{recipe.get('description', '?')}

"""
        
        keyboard = [
            [InlineKeyboardButton('◀️ Назад', callback_data='back_to_analysis')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(response, reply_markup=reply_markup, parse_mode='markdown')
        
    elif query.data == 'back_to_analysis':
        analysis = context.user_data.get('last_analysis', {})
        risk_emoji = {'safe': '✅', 'moderate': '⚠️', 'high': '🔴'}.get(analysis.get('riskLevel'), '❓')
        response = f"""**{risk_emoji} {analysis.get('productName', 'Продукт')}**

**Вердикт:** {analysis.get('verdict', '?')}
"""
        keyboard = [
            [InlineKeyboardButton('🍽️ Рецепты', callback_data='recipes')],
            [InlineKeyboardButton('📸 Новая фото', callback_data='cancel')]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(response, reply_markup=reply_markup, parse_mode='markdown')
        
    elif query.data == 'cancel':
        await query.edit_message_text('❌ Отменено')

async def history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    db = sqlite3.connect('labelspy_tg.db')
    cursor = db.cursor()
    cursor.execute('SELECT product_name, verdict, risk_level, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', (user_id,))
    results = cursor.fetchall()
    db.close()
    
    if not results:
        await update.message.reply_text('📭 История пуста')
        return
    
    response = '📋 **Твоя история анализов:**\n\n'
    for product, verdict, risk, created_at in results:
        risk_emoji = {'safe': '✅', 'moderate': '⚠️', 'high': '🔴'}.get(risk, '❓')
        response += f"{risk_emoji} **{product}** - {verdict}\n`{created_at}`\n\n"
    
    await update.message.reply_text(response, parse_mode='markdown')

def main():
    app = Application.builder().token(TG_TOKEN).build()
    
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help', help_command))
    app.add_handler(CommandHandler('history', history))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(CallbackQueryHandler(button_callback))
    
    logger.info('🚀 Bot started')
    app.run_polling()

if __name__ == '__main__':
    main()
