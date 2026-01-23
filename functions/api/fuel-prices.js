export async function onRequest(context) {
    // We wrap Tesco in a CORS proxy to bypass their Cloudflare IP block
    const TESCO_URL = "https://corsproxy.io/?https://www.tesco.com/fuel_prices/fuel_prices_data.json";
    
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
      { name: "Tesco", url: TESCO_URL } // <--- Proxy Applied Here
    ];
  
    // 1. Check Cache (Use 'v5' to ensure we don't load the old broken data)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated-v5"); 
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Headers to mimic a real Chrome Browser (helps with Sainsbury's/Asda)
    const fakeBrowserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Cache-Control": "no-cache"
    };
  
    // 3. Fetch all sources
    const requests = SOURCES.map(async (source) => {
      try {
        const response = await fetch(source.url, { 
          headers: fakeBrowserHeaders,
          redirect: 'follow'
        });
        
        if (!response.ok) return null;
  
        const data = await response.json();
        
        // Handle different data structures
        if (data.stations) return data.stations;
        if (data.sites) return data.sites;
        return null;
  
      } catch (err) {
        console.warn(`Failed to fetch ${source.name}`, err);
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
        "Cache-Control": "public, max-age=3600" // Cache for 1 hour
      }
    });
  
    // 6. Save to Cache
    context.waitUntil(cache.put(cacheKey, response.clone()));
  
    return response;
  }