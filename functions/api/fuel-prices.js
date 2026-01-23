export async function onRequest(context) {
    // List of all UK Government Scheme endpoints
    const SOURCES = [
      "https://fuelprices.asconagroup.co.uk/newfuel.json",
      "https://storelocator.asda.com/fuel_prices_data.json",
      "https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json",
      "https://fuelprices.esso.co.uk/latestdata.json",
      "https://jetlocal.co.uk/fuel_prices_data.json",
      "https://www.morrisons.com/fuel-prices/fuel.json",
      "https://moto-way.com/fuel-price/fuel_prices.json",
      "https://fuel.motorfuelgroup.com/fuel_prices_data.json",
      "https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json",
      "https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json",
      "https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json",
      "https://www.shell.co.uk/fuel-prices-data.html",
      "https://www.tesco.com/fuel_prices/fuel_prices_data.json"
    ];
  
    // 1. Check Cache (We don't want to spam their servers)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated");
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Fetch all sources in parallel
    const requests = SOURCES.map(url => fetch(url).then(r => r.json()).catch(() => null));
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
        "Access-Control-Allow-Origin": "*", // Allow your app to read it
        "Cache-Control": "public, max-age=3600" // Cache for 1 hour
      }
    });
  
    // 5. Save to Cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }