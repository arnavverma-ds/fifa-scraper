const puppeteer = require('puppeteer');
const fs = require('fs');

// Helper: Fetch live exchange rates (Base: USD)
async function getExchangeRates() {
  try {
    console.log('💱 Fetching daily exchange rates...');
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    console.log(`✅ Rates fetched: 1 USD = ${data.rates.CAD} CAD, ${data.rates.MXN} MXN`);
    return data.rates;
  } catch (error) {
    console.error('⚠️ Failed to fetch exchange rates, using defaults');
    return { CAD: 1.44, MXN: 20.5, USD: 1 };
  }
}

// Helper: Get currency based on venue country
function getCurrencyByCountry(venueCountry) {
  if (venueCountry === 'Mexico') return 'MXN';
  if (venueCountry === 'Canada') return 'CAD';
  return 'USD';
}

// Helper: Find lowest available price from Prices array
function getLowestAvailablePrice(prices) {
  if (!prices || !Array.isArray(prices)) return { price: null, loungeName: null };
  
  let lowestPrice = null;
  let lowestLoungeName = null;
  
  for (const lounge of prices) {
    if (!lounge.HasAvailableSeats) continue;
    if (!lounge.PriceCategories || !Array.isArray(lounge.PriceCategories)) continue;
    
    for (const category of lounge.PriceCategories) {
      if (category.IsAvailable && category.Amount > 0) {
        if (lowestPrice === null || category.Amount < lowestPrice) {
          lowestPrice = category.Amount;
          lowestLoungeName = lounge.Name;
        }
      }
    }
  }
  
  return { price: lowestPrice, loungeName: lowestLoungeName };
}

async function scrapeHospitalityData() {
  console.log('🚀 Starting FIFA Hospitality Scraper (Starting At Prices)...\n');
  
  const rates = await getExchangeRates();

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
    // Scrape from Mexico portal - it shows ALL matches
    console.log(`\n🌍 Scraping from Mexico portal (shows all matches)...`);
    
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    console.log(`📡 Navigating to FIFA Mexico website...`);
    await page.goto('https://fifaworldcup26.hospitality.fifa.com/mx/en/choose-matches', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForTimeout(5000);
    console.log('✅ Page loaded');

    console.log('🔍 Fetching match data from API...');
    
    const matches = await page.evaluate(async () => {
      const matchRes = await fetch('/next-api/matches-all?productCode=26FWC&productType=5', {
        headers: { 'country-tag': 'mx', 'language-tag': 'en' }
      });
      const rawMatches = await matchRes.json();
      
      return rawMatches.filter(m => m.MatchNumber).map(m => ({
        matchNumber: m.MatchNumber,
        stage: m.Stage || '',
        hostTeam: m.HostTeam?.ExternalName || 'TBD',
        opposingTeam: m.OpposingTeam?.ExternalName || 'TBD',
        venue: m.Venue?.Name || '',
        city: m.Venue?.Town || '',
        venueCountry: m.Venue?.Country || '',
        matchDate: m.MatchDate || '',
        matchDayTime: m.MatchDayTime || '',
        prices: m.Prices || []
      }));
    });

    console.log(`✅ Found ${matches.length} matches`);
    
    await page.close();

    // Process matches
    let allMatches = [];
    let matchesWithPricing = 0;
    
    for (const match of matches) {
      const priceInfo = getLowestAvailablePrice(match.prices);
      
      if (priceInfo.price !== null) {
        matchesWithPricing++;
        
        // Currency based on VENUE COUNTRY (not portal!)
        const currency = getCurrencyByCountry(match.venueCountry);
        
        // Convert to USD based on venue country
        let priceUSD = priceInfo.price;
        if (currency === 'MXN') {
          priceUSD = Math.round(priceInfo.price / rates.MXN);
        } else if (currency === 'CAD') {
          priceUSD = Math.round(priceInfo.price / rates.CAD);
        }
        // USD stays as is
        
        allMatches.push({
          matchNumber: match.matchNumber,
          stage: match.stage,
          hostTeam: match.hostTeam,
          opposingTeam: match.opposingTeam,
          venue: match.venue,
          city: match.city,
          country: match.venueCountry,
          matchDate: match.matchDate,
          matchDayTime: match.matchDayTime,
          startingPrice: priceInfo.price,
          startingLounge: priceInfo.loungeName,
          originalCurrency: currency,
          priceUSD: priceUSD
        });
      }
    }
    
    console.log(`✅ ${matchesWithPricing} matches have available pricing`);

    // Sort by match number
    allMatches.sort((a, b) => a.matchNumber - b.matchNumber);

    console.log(`\n📊 TOTAL: ${allMatches.length} matches with pricing\n`);

    const now = new Date();
    const timestamp = now.toISOString().split('T')[0];

    const data = {
      scrapedAt: now.toISOString(),
      exchangeRates: rates,
      totalMatches: allMatches.length,
      matches: allMatches
    };

    if (!fs.existsSync('data')) {
      fs.mkdirSync('data');
    }
    
    fs.writeFileSync(`data/fifa_data_${timestamp}.json`, JSON.stringify(data, null, 2));
    fs.writeFileSync('data/fifa_data_latest.json', JSON.stringify(data, null, 2));
    console.log(`📁 Saved JSON`);

    // CSV - ONE ROW PER MATCH
    const csvRows = [
      'Match Number,Stage,Host Team,Away Team,Venue,City,Country,Date,Time,Starting Price,Starting Lounge,Original Currency,Price (USD)'
    ];
    
    allMatches.forEach(match => {
      csvRows.push([
        match.matchNumber,
        `"${match.stage}"`,
        `"${match.hostTeam}"`,
        `"${match.opposingTeam}"`,
        `"${match.venue}"`,
        `"${match.city}"`,
        `"${match.country}"`,
        `"${match.matchDate}"`,
        `"${match.matchDayTime}"`,
        match.startingPrice,
        `"${match.startingLounge}"`,
        match.originalCurrency,
        match.priceUSD
      ].join(','));
    });
    
    fs.writeFileSync(`data/fifa_data_${timestamp}.csv`, csvRows.join('\n'));
    fs.writeFileSync('data/fifa_data_latest.csv', csvRows.join('\n'));
    
    console.log(`📁 Saved CSV`);
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
