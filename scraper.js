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
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    console.log(`✅ Rates fetched: 1 USD = ${data.rates.CAD} CAD, ${data.rates.MXN} MXN`);
    return data.rates;
  } catch (error) {
    console.error('⚠️ Failed to fetch exchange rates, using defaults');
    return { CAD: 1.44, MXN: 20.5, USD: 1 };
  }
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
    let allMatches = [];

    for (const country of COUNTRIES) {
      console.log(`\n🌍 Scraping ${country.name} (${country.code.toUpperCase()})...`);
      
      const page = await browser.newPage();
      
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

      await page.waitForTimeout(5000);
      console.log('✅ Page loaded');

      console.log('🔍 Fetching match data from API...');
      const countryCode = country.code;
      
      const matches = await page.evaluate(async (countryCode) => {
        const matchRes = await fetch('/next-api/matches-all?productCode=26FWC&productType=5', {
          headers: { 'country-tag': countryCode, 'language-tag': 'en' }
        });
        const rawMatches = await matchRes.json();
        
        return rawMatches.filter(m => m.MatchNumber).map(m => ({
          matchNumber: m.MatchNumber,
          stage: m.Stage || '',
          hostTeam: m.HostTeam?.ExternalName || 'TBD',
          opposingTeam: m.OpposingTeam?.ExternalName || 'TBD',
          venue: m.Venue?.Name || '',
          city: m.Venue?.Town || '',
          country: m.Venue?.Country || '',
          matchDate: m.MatchDate || '',
          matchDayTime: m.MatchDayTime || '',
          isAvailable: m.IsAvailable || false,
          prices: m.Prices || []
        }));
      }, countryCode);

      console.log(`✅ Found ${matches.length} matches on ${country.code.toUpperCase()} site`);

      let matchesWithPricing = 0;
      
      for (const match of matches) {
        const priceInfo = getLowestAvailablePrice(match.prices);
        
        if (priceInfo.price !== null) {
          matchesWithPricing++;
          
          let priceUSD = priceInfo.price;
          if (country.currency !== 'USD') {
            const rate = rates[country.currency] || 1;
            priceUSD = Math.round(priceInfo.price / rate);
          }
          
          allMatches.push({
            matchNumber: match.matchNumber,
            stage: match.stage,
            hostTeam: match.hostTeam,
            opposingTeam: match.opposingTeam,
            venue: match.venue,
            city: match.city,
            country: match.country,
            matchDate: match.matchDate,
            matchDayTime: match.matchDayTime,
            startingPrice: priceInfo.price,
            startingLounge: priceInfo.loungeName,
            originalCurrency: country.currency,
            priceUSD: priceUSD,
            portal: country.name
          });
        }
      }
      
      console.log(`✅ ${matchesWithPricing} matches have available pricing`);
      
      await page.close();
    }

    // Remove duplicates - keep lowest USD price per match
    const matchMap = new Map();
    for (const match of allMatches) {
      const existing = matchMap.get(match.matchNumber);
      if (!existing || match.priceUSD < existing.priceUSD) {
        matchMap.set(match.matchNumber, match);
      }
    }
    
    const uniqueMatches = Array.from(matchMap.values());
    uniqueMatches.sort((a, b) => a.matchNumber - b.matchNumber);

    console.log(`\n📊 TOTAL: ${uniqueMatches.length} unique matches with pricing\n`);

    const now = new Date();
    const timestamp = now.toISOString().split('T')[0];

    const data = {
      scrapedAt: now.toISOString(),
      exchangeRates: rates,
      totalMatches: uniqueMatches.length,
      matches: uniqueMatches
    };

    if (!fs.existsSync('data')) {
      fs.mkdirSync('data');
    }
    
    fs.writeFileSync(`data/fifa_data_${timestamp}.json`, JSON.stringify(data, null, 2));
    fs.writeFileSync('data/fifa_data_latest.json', JSON.stringify(data, null, 2));
    console.log(`📁 Saved JSON`);

    // CSV - ONE ROW PER MATCH
    const csvRows = [
      'Match Number,Stage,Host Team,Away Team,Venue,City,Country,Date,Time,Starting Price,Starting Lounge,Original Currency,Price (USD),Portal'
    ];
    
    uniqueMatches.forEach(match => {
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
        match.priceUSD,
        `"${match.portal}"`
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
