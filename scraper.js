const puppeteer = require('puppeteer');
const fs = require('fs');

// All 3 host countries
const COUNTRIES = [
  { code: 'us', name: 'United States', currency: 'USD' },
  { code: 'ca', name: 'Canada', currency: 'CAD' },
  { code: 'mx', name: 'Mexico', currency: 'MXN' }
];

// Helper: Fetch live exchange rates (Base: USD)
async function getExchangeRates() {
  try {
    console.log('💱 Fetching daily exchange rates...');
    // Using a free public API for rates
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    console.log(`✅ Rates fetched: 1 USD = ${data.rates.CAD} CAD, ${data.rates.MXN} MXN`);
    return data.rates;
  } catch (error) {
    console.error('⚠️ Failed to fetch exchange rates, defaulting to 1.0 (no conversion)');
    return { CAD: 1, MXN: 1, USD: 1 };
  }
}

async function scrapeHospitalityData() {
  console.log('🚀 Starting FIFA Hospitality Scraper (Matches 1-104)...\n');
  
  // 1. Get Real-Time Exchange Rates
  const rates = await getExchangeRates();

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
        const matchRes = await fetch('/next-api/matches-all?productCode=26FWC&productType=5', {
          headers: { 'country-tag': countryCode, 'language-tag': 'en' }
        });
        const rawMatches = await matchRes.json();
        
        // --- CHANGE: Removed "Stage" filter to get ALL matches (1-104) ---
        // We only require that the match has a MatchNumber
        const allFixtureMatches = rawMatches.filter(m => m.MatchNumber);
        
        const results = [];
        
        for (let i = 0; i < allFixtureMatches.length; i++) {
          const m = allFixtureMatches[i];
          
          const match = {
            performanceId: m.PerformanceId,
            matchNumber: m.MatchNumber, // MATCH NUMBER IS KEY
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
            await new Promise(r => setTimeout(r, 200)); // Small delay to avoid rate limits
            const loungeRes = await fetch(
              `/next-api/lounges?productCode=26FWC&productTypeCode=SM&quantity=1&performanceId=${m.PerformanceId}`,
              { headers: { 'country-tag': countryCode, 'language-tag': 'en' } }
            );
            
            if (loungeRes.ok) {
              const lounges = await loungeRes.json();
              match.lounges = lounges.map(l => ({
                title: l.title,
                priceString: l.comparePrice || '',
                // Extract numeric price
                priceNumber: (() => {
                  const priceMatch = (l.comparePrice || '').match(/[\$€]?([0-9,]+)/);
                  return priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
                })()
              }));
            }
          } catch (e) {
            // No pricing available for this match on this country site
          }
          
          results.push(match);
        }
        
        return results;
      }, countryCode);

      // Filter: Keep only matches where we found pricing
      const matchesWithPricing = matches.filter(m => m.lounges && m.lounges.length > 0);
      
      console.log(`✅ Found ${matches.length} total matches on ${country.code.toUpperCase()} site`);
      console.log(`✅ ${matchesWithPricing.length} matches have active pricing here`);

      // Add Metadata + Convert Currency to USD
      matchesWithPricing.forEach(match => {
        match.portal = country.name;
        match.originalCurrency = country.currency;
        
        match.lounges.forEach(lounge => {
          // --- CHANGE: Calculate USD Price ---
          let usdPrice = 0;
          if (country.currency === 'USD') {
            usdPrice = lounge.priceNumber;
          } else {
            // Convert: Price / Rate
            // e.g., 100 CAD / 1.35 = 74 USD
            const rate = rates[country.currency] || 1; 
            usdPrice = lounge.priceNumber / rate;
          }
          lounge.priceUSD = Math.round(usdPrice); // Round to nearest dollar
        });
      });

      allMatchesWithPricing = allMatchesWithPricing.concat(matchesWithPricing);
      
      await page.close();
    }

    console.log(`\n📊 TOTAL: ${allMatchesWithPricing.length} pricing rows collected across all portals\n`);

    // Create timestamp
    const now = new Date();
    const timestamp = now.toISOString().split('T')[0];
    
    // Sort all data by Match Number (1 to 104)
    allMatchesWithPricing.sort((a, b) => a.matchNumber - b.matchNumber);

    const data = {
      scrapedAt: now.toISOString(),
      exchangeRates: rates,
      totalMatchesWithPricing: allMatchesWithPricing.length,
      matches: allMatchesWithPricing
    };

    // Save JSON
    const jsonFilename = `data/fifa_data_${timestamp}.json`;
    const latestFilename = 'data/fifa_data_latest.json';
    
    if (!fs.existsSync('data')) {
      fs.mkdirSync('data');
    }
    
    fs.writeFileSync(jsonFilename, JSON.stringify(data, null, 2));
    fs.writeFileSync(latestFilename, JSON.stringify(data, null, 2));
    console.log(`📁 Saved JSON: ${jsonFilename}`);

    // --- CHANGE: Create Final Consumable CSV ---
    const csvRows = [
      'Match Number,Stage,Host Team,Away Team,Venue,City,Country,Date,Time,Lounge Type,Original Price,Original Currency,Price (USD),Portal'
    ];
    
    allMatchesWithPricing.forEach(match => {
      match.lounges.forEach(lounge => {
        csvRows.push([
          match.matchNumber,  // <--- Primary Column
          `"${match.stage}"`,
          `"${match.hostTeam.name}"`,
          `"${match.opposingTeam.name}"`,
          `"${match.venue.name}"`,
          `"${match.venue.town}"`,
          `"${match.venue.country}"`,
          `"${match.matchDate}"`,
          `"${match.matchDayTime}"`,
          `"${lounge.title}"`,
          lounge.priceNumber,
          match.originalCurrency,
          lounge.priceUSD,    // <--- Converted USD Price
          match.portal
        ].join(','));
      });
    });
    
    const csvFilename = `data/fifa_data_${timestamp}.csv`;
    const latestCsvFilename = 'data/fifa_data_latest.csv';
    
    fs.writeFileSync(csvFilename, csvRows.join('\n'));
    fs.writeFileSync(latestCsvFilename, csvRows.join('\n'));
    
    console.log(`📁 Saved CSV: ${csvFilename}`);
    console.log('\n✅ Scraping complete!');
    
    return data;

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

scrapeHospitalityData()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Failed:', error);
    process.exit(1);
  });
