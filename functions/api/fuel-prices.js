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
  
    // 1. Check Cache (Renamed to v2 to force a refresh for you)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated-v2"); 
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Fetch all sources in parallel with User-Agent Headers
    const requests = SOURCES.map(url => 
      fetch(url, {
        headers: {
          // This header tricks Tesco/Sainsbury's into thinking we are a real browser
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      })
      .then(r => r.json())
      .catch(err => {
        // Quietly fail for individual sources so the whole app doesn't crash
        console.warn(`Failed to fetch ${url}`, err);
        return null;
      })
    );
    
    const results = await Promise.all(requests);
  
    // 3. Merge Data
    let allStations = [];
    results.forEach(data => {
      if (data && data.stations) {
        allStations = [...allStations, ...data.stations];
      }
    });
  
    // 4. Create Response
    const json = JSON.stringify({ 
      updated: new Date().toISOString(),
      stations: allStations 
    });
  
    response = new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
        "Cache-Control": "public, max-age=3600" // Cache for 1 hour
      }
    });
  
    // 5. Save to Cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }