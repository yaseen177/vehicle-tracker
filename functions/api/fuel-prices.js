export async function onRequest(context) {
    const SOURCES = [
      "https://fuelprices.asconagroup.co.uk/newfuel.json",
      "https://storelocator.asda.com/fuel_prices_data.json",
      "https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json",
      "https://fuelprices.esso.co.uk/latestdata.json",
      "https://jetlocal.co.uk/fuel_prices_data.json",
      "https://devapi.krlpos.com/integration/live_price/krl",
      "https://www.morrisons.com/fuel-prices/fuel.json",
      "https://moto-way.com/fuel-price/fuel_prices.json",
      "https://fuel.motorfuelgroup.com/fuel_prices_data.json",
      "https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json",
      "https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json",
      "https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json",
      "https://www.shell.co.uk/fuel-prices-data.html",
      "https://www.tesco.com/fuel_prices/fuel_prices_data.json"
    ];
  
    // 1. Check Cache (Updated to 'v4' to force a fresh try for Tesco)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated-v4"); 
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Define Headers that mimic a real Chrome Browser
    const fakeBrowserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "max-age=0"
    };
  
    // 3. Fetch all sources in parallel
    const requests = SOURCES.map(url => 
      fetch(url, {
        method: 'GET',
        headers: fakeBrowserHeaders,
        redirect: 'follow'
      })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch(err => {
        // Log the error but don't break the app
        console.warn(`Failed to fetch ${url}:`, err.message);
        return null; 
      })
    );
    
    const results = await Promise.all(requests);
  
    // 4. Merge Data
    let allStations = [];
    results.forEach(data => {
      // Standard schema (Tesco, Asda, etc)
      if (data && data.stations) {
        allStations = [...allStations, ...data.stations];
      }
      // Handle edge cases if schema differs slightly
      else if (data && data.sites) {
          allStations = [...allStations, ...data.sites];
      }
    });
  
    // 5. Create Response
    const json = JSON.stringify({ 
      updated: new Date().toISOString(),
      count: allStations.length, // Added for debugging
      stations: allStations 
    });
  
    response = new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
        "Cache-Control": "public, max-age=3600" // Cache for 1 hour
      }
    });
  
    // 6. Save to Cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }