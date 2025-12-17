# LabelSpy Telegram Bot

**Full-featured bot for product label analysis directly from Telegram!**

## Features

- 📸 **OCR from photos** - recognize text from package using Yandex Vision
- 🧪 **AI analysis** - check composition via Google Gemini 2.5 Flash
- ✅ **Verdict** - safety assessment (safe/moderate/high)
- 🏷️ **E-codes** - identify food additives
- ⚠️ **Allergens** - highlight dangerous components
- 🍽️ **Recipes** - AI generates recipe suggestions
- 💾 **History** - all analyses saved to database

## Quick Start

### Get API Keys

**Telegram Token:**
1. Message @BotFather in Telegram
2. /newbot → choose name and username
3. Copy token

**Yandex Vision API:**
1. Register at https://cloud.yandex.ru
2. Create Service Account
3. Enable Vision API
4. Get API Key and Folder ID

**Google Gemini API:**
1. Go to https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Copy key

### Installation

```bash
cd telegram_bot
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your keys
```

### Run

```bash
python bot.py
```

## Deployment

### VPS (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install python3.10 python3-pip screen
git clone https://github.com/codgorbachev-art/labelspy-ocr.git
cd labelspy-ocr/telegram_bot
pip install -r requirements.txt
nano .env  # add your keys
screen -S labelspy_bot
python bot.py
```

### Heroku (Free)

```bash
heroku create labelspy-bot
git push heroku telegram-bot:main
heroku config:set TELEGRAM_TOKEN=...
heroku ps:scale worker=1
```

## Usage

1. Find bot in Telegram
2. /start
3. Send photo of package
4. Press "Analyze" button
5. Get verdict with recommendations
6. Press "Recipes" for AI suggestions
7. /history to see all analyses

## Database

All analyses saved to `labelspy_tg.db` (SQLite)

## Config

```env
TELEGRAM_TOKEN=your_token
YANDEX_API_KEY=your_key
YANDEX_FOLDER_ID=your_folder
GEMINI_API_KEY=your_gemini_key
```

## License

MIT
