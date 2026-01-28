const puppeteer = require('puppeteer');
const fs = require('fs');

// All 3 host countries
const COUNTRIES = [
  { code: 'us', name: 'United States', currency: 'USD' },
  { code: 'ca', name: 'Canada', currency: 'CAD' },
  { code: 'mx', name: 'Mexico', currency: 'MXN' }
];

async function scrapeHospitalityData() {
  console.log('🚀 Starting FIFA Hospitality Scraper (All Countries)...\n');
  
  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  try {
    let allMatchesWithPricing = [];

    // Loop through each country
    for (const country of COUNTRIES) {
      console.log(`\n🌍 Scraping ${country.name} (${country.code.toUpperCase()})...`);
      
      const page = await browser.newPage();
      
      // Set headers to look like a real browser
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });

      console.log(`📡 Navigating to FIFA ${country.name} website...`);
      await page.goto(`https://fifaworldcup26.hospitality.fifa.com/${country.code}/en/choose-matches`, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Wait for page to fully load
      await page.waitForTimeout(5000);
      console.log('✅ Page loaded');

      // Execute scraping script in browser context
      console.log('🔍 Scraping match data...');
      const countryCode = country.code;
      const matches = await page.evaluate(async (countryCode) => {
        // Fetch all matches
        const matchRes = await fetch('/next-api/matches-all?productCode=26FWC', {
          headers: { 'country-tag': countryCode, 'language-tag': 'en' }
        });
        const rawMatches = await matchRes.json();
        
        // Filter group stage only
        const groupMatches = rawMatches.filter(m => m.Stage === 'GROUP STAGE MATCHES');
        
        const results = [];
        
        for (let i = 0; i < groupMatches.length; i++) {
          const m = groupMatches[i];
          
          const match = {
            performanceId: m.PerformanceId,
            matchNumber: m.MatchNumber,
            stage: m.Stage,
            hostTeam: {
              name: m.HostTeam?.ExternalName || 'TBD',
              code: m.HostTeam?.Code || ''
            },
            opposingTeam: {
              name: m.OpposingTeam?.ExternalName || 'TBD',
              code: m.OpposingTeam?.Code || ''
            },
            venue: {
              name: m.Venue?.Name || '',
              code: m.Venue?.Code || '',
              town: m.Venue?.Town || '',
              country: m.Venue?.Country || ''
            },
            matchDate: m.MatchDate || '',
            matchDayTime: m.MatchDayTime || '',
            countryCode: m.CountryCode || '',
            lounges: []
          };
          
          // Fetch pricing for each match
          try {
            await new Promise(r => setTimeout(r, 300)); // Small delay
            const loungeRes = await fetch(
              `/next-api/lounges?productCode=26FWC&productTypeCode=SM&quantity=1&performanceId=${m.PerformanceId}`,
              { headers: { 'country-tag': countryCode, 'language-tag': 'en' } }
            );
            
            if (loungeRes.ok) {
              const lounges = await loungeRes.json();
              match.lounges = lounges.map(l => ({
                title: l.title,
                price: l.comparePrice || '',
                priceNumber: (() => {
                  const priceMatch = (l.comparePrice || '').match(/[\$€]?([0-9,]+)/);
                  return priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
                })()
              }));
            }
          } catch (e) {
            // No pricing available
          }
          
          results.push(match);
        }
        
        return results;
      }, countryCode);

      // Filter only matches with pricing
      const matchesWithPricing = matches.filter(m => m.lounges && m.lounges.length > 0);
      
      console.log(`✅ Found ${matches.length} total group stage matches`);
      console.log(`✅ ${matchesWithPricing.length} matches have pricing data`);

      // Add country/currency info to each match
      matchesWithPricing.forEach(match => {
        match.portal = country.name;
        match.currency = country.currency;
      });

      allMatchesWithPricing = allMatchesWithPricing.concat(matchesWithPricing);
      
      await page.close();
    }

    console.log(`\n📊 TOTAL: ${allMatchesWithPricing.length} matches with pricing across all countries\n`);

    // Create timestamp
    const now = new Date();
    const timestamp = now.toISOString().split('T')[0];
    
    // Prepare data object
    const data = {
      scrapedAt: now.toISOString(),
      totalMatchesWithPricing: allMatchesWithPricing.length,
      countries: COUNTRIES.map(c => c.name),
      matches: allMatchesWithPricing
    };

    // Save to JSON file
    const jsonFilename = `data/fifa_data_${timestamp}.json`;
    const latestFilename = 'data/fifa_data_latest.json';
    
    // Ensure data directory exists
    if (!fs.existsSync('data')) {
      fs.mkdirSync('data');
    }
    
    fs.writeFileSync(jsonFilename, JSON.stringify(data, null, 2));
    fs.writeFileSync(latestFilename, JSON.stringify(data, null, 2));
    
    console.log(`📁 Saved to ${jsonFilename}`);
    console.log(`📁 Saved to ${latestFilename}`);

    // Create CSV for Google Sheets
    const csvRows = ['Match Number,Host Team,Away Team,Venue,City,Country,Date,Time,Lounge Type,Price,Currency,Portal'];
    
    allMatchesWithPricing.forEach(match => {
      match.lounges.forEach(lounge => {
        csvRows.push([
          match.matchNumber,
          `"${match.hostTeam.name}"`,
          `"${match.opposingTeam.name}"`,
          `"${match.venue.name}"`,
          `"${match.venue.town}"`,
          `"${match.venue.country}"`,
          `"${match.matchDate}"`,
          `"${match.matchDayTime}"`,
          `"${lounge.title}"`,
          lounge.priceNumber,
          match.currency,
          match.portal
        ].join(','));
      });
    });
    
    const csvFilename = `data/fifa_data_${timestamp}.csv`;
    const latestCsvFilename = 'data/fifa_data_latest.csv';
    
    fs.writeFileSync(csvFilename, csvRows.join('\n'));
    fs.writeFileSync(latestCsvFilename, csvRows.join('\n'));
    
    console.log(`📁 Saved to ${csvFilename}`);
    console.log(`📁 Saved to ${latestCsvFilename}`);

    console.log('\n✅ Scraping complete!');
    
    return data;

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the scraper
scrapeHospitalityData()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });
