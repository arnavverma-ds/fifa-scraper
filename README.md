# FIFA World Cup 2026 Hospitality Scraper 🏆⚽

Automated daily scraper for FIFA World Cup 2026 hospitality ticket prices.

## What It Does

- ✅ Runs automatically every morning at 6 AM IST
- ✅ Scrapes all group stage matches from FIFA website
- ✅ Extracts pricing for all hospitality packages
- ✅ Saves data as JSON and CSV
- ✅ Updates Google Sheets (optional)

## Data Collected

For each match:
- Match number, teams, venue, date/time
- Pricing for all packages:
  - Pitchside Lounge (~$3,000-7,000)
  - VIP (~$2,700-4,500)
  - Trophy Lounge (~$2,200-3,700)
  - Champions Club (~$2,000-3,400)
  - FIFA Pavilion (~$1,400-2,900)

## Files

```
data/
├── fifa_data_latest.json    # Latest scraped data
├── fifa_data_latest.csv     # Latest data in CSV format
├── fifa_data_2026-01-21.json # Historical data by date
└── fifa_data_2026-01-21.csv
```

## Manual Run

To trigger manually:
1. Go to **Actions** tab in GitHub
2. Click **Daily FIFA Scraper**
3. Click **Run workflow**

## Setup Google Sheets (Optional)

See the setup guide for connecting to Google Sheets.

## License

MIT
