export async function onRequest(context) {
    // We use AllOrigins as the proxy for Tesco now
    const TESCO_URL = "https://www.tesco.com/fuel_prices/fuel_prices_data.json";
    const TESCO_PROXY = `https://api.allorigins.win/raw?url=${encodeURIComponent(TESCO_URL)}`;
    
    const SOURCES = [
      { name: "Ascona", url: "https://fuelprices.asconagroup.co.uk/newfuel.json" },
      { name: "Asda", url: "https://storelocator.asda.com/fuel_prices_data.json" },
      { name: "BP", url: "https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json" },
      { name: "Esso", url: "https://fuelprices.esso.co.uk/latestdata.json" },
      { name: "Jet", url: "https://jetlocal.co.uk/fuel_prices_data.json" },
      { name: "Karan", url: "https://devapi.krlpos.com/integration/live_price/krl" },
      { name: "Morrisons", url: "https://www.morrisons.com/fuel-prices/fuel.json" },
      { name: "Moto", url: "https://moto-way.com/fuel-price/fuel_prices.json" },
      { name: "MFG", url: "https://fuel.motorfuelgroup.com/fuel_prices_data.json" },
      { name: "Rontec", url: "https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json" },
      { name: "Sainsburys", url: "https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json" },
      { name: "SGN", url: "https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json" },
      { name: "Shell", url: "https://www.shell.co.uk/fuel-prices-data.html" },
      { name: "Tesco", url: TESCO_PROXY } // <--- New Proxy Applied Here
    ];
  
    // 1. Check Cache (Version 6 to clear previous attempts)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated-v6"); 
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Generic Headers (Keep it simple)
    const headers = {
      "User-Agent": "Mozilla/5.0 (Compatible; FuelTracker/1.0)",
      "Accept": "application/json"
    };
  
    // 3. Fetch all sources
    const requests = SOURCES.map(async (source) => {
      try {
        const response = await fetch(source.url, { headers });
        
        // If a specific source fails, skip it so the others still load
        if (!response.ok) return null;
  
        const data = await response.json();
        
        // Handle standard "stations" or alternative "sites" key
        if (data.stations) return data.stations;
        if (data.sites) return data.sites;
        
        // Handle AllOrigins wrapping (sometimes it wraps data in a 'contents' field)
        if (data.contents) {
            const inner = JSON.parse(data.contents);
            return inner.stations || inner.sites || null;
        }
  
        return null;
  
      } catch (err) {
        // console.warn(`Skipping ${source.name}: ${err.message}`);
        return null;
      }
    });
    
    const results = await Promise.all(requests);
  
    // 4. Flatten the arrays
    let allStations = [];
    results.forEach(list => {
      if (list && Array.isArray(list)) {
        allStations = [...allStations, ...list];
      }
    });
  
    // 5. Create Response
    const json = JSON.stringify({ 
      updated: new Date().toISOString(),
      count: allStations.length,
      stations: allStations 
    });
  
    response = new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
        "Cache-Control": "public, max-age=3600"
      }
    });
  
    // 6. Save to Cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }