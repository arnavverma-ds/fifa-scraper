const { google } = require('googleapis');
const fs = require('fs');

async function updateGoogleSheets() {
  console.log('📊 Updating Google Sheets...\n');

  // Load credentials from environment variable
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const sheetId = process.env.SHEET_ID;

  if (!credentials || !sheetId) {
    console.log('⚠️ Google credentials or Sheet ID not found. Skipping Sheets update.');
    return;
  }

  // Authenticate with Google
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Load the latest data
  const data = JSON.parse(fs.readFileSync('data/fifa_data_latest.json', 'utf8'));

  // Prepare rows for the sheet
  const headerRow = [
    'Match #',
    'Host Team',
    'Away Team',
    'Venue',
    'City',
    'Country',
    'Date',
    'Time',
    'Pitchside Lounge',
    'VIP',
    'Trophy Lounge',
    'Champions Club',
    'FIFA Pavilion',
    'Last Updated'
  ];

  const rows = [headerRow];

  data.matches.forEach(match => {
    // Get prices for each lounge type
    const getPrice = (title) => {
      const lounge = match.lounges.find(l => l.title.toLowerCase().includes(title.toLowerCase()));
      return lounge ? lounge.priceNumber : '';
    };

    rows.push([
      match.matchNumber,
      match.hostTeam.name,
      match.opposingTeam.name,
      match.venue.name,
      match.venue.town,
      match.venue.country,
      match.matchDate,
      match.matchDayTime,
      getPrice('Pitchside'),
      getPrice('VIP'),
      getPrice('Trophy'),
      getPrice('Champions'),
      getPrice('Pavilion'),
      new Date().toISOString()
    ]);
  });

  try {
    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:N'
    });

    // Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });

    console.log(`✅ Updated Google Sheet with ${rows.length - 1} matches`);
    console.log(`🔗 https://docs.google.com/spreadsheets/d/${sheetId}`);

  } catch (error) {
    console.error('❌ Error updating Google Sheets:', error.message);
    throw error;
  }
}

updateGoogleSheets()
  .then(() => {
    console.log('\n🎉 Sheets update complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });
