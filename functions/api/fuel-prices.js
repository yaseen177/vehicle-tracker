export async function onRequest(context) {
    // We define Tesco separately to track it specifically
    const TESCO_URL = "https://www.tesco.com/fuel_prices/fuel_prices_data.json";
    
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
      { name: "Tesco", url: TESCO_URL }
    ];
  
    // 1. Cache Bypass (For testing, we use a random key to ensure NO caching)
    // Once fixed, we will switch back to caching.
    const randomKey = `no-cache-${Date.now()}`; 
  
    // 2. Headers to mimic a real user visiting from Google
    const fakeHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": "https://www.google.com/",
      "Origin": "https://www.google.com",
      "DNT": "1",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache"
    };
  
    const debugLog = [];
  
    // 3. Fetch all sources
    const requests = SOURCES.map(async (source) => {
      try {
        const start = Date.now();
        const response = await fetch(source.url, {
          method: 'GET',
          headers: fakeHeaders,
          redirect: 'follow'
        });
        
        const time = Date.now() - start;
  
        // Log the result for the debug report
        debugLog.push({ 
          name: source.name, 
          status: response.status, 
          ok: response.ok,
          time: `${time}ms`
        });
  
        if (!response.ok) return null;
  
        // Try to parse JSON
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          debugLog.push({ name: source.name, error: "Invalid JSON", preview: text.substring(0, 50) });
          return null;
        }
  
      } catch (err) {
        debugLog.push({ name: source.name, error: err.message });
        return null;
      }
    });
    
    const results = await Promise.all(requests);
  
    // 4. Merge Data
    let allStations = [];
    results.forEach(data => {
      if (!data) return;
      if (data.stations) allStations = [...allStations, ...data.stations];
      else if (data.sites) allStations = [...allStations, ...data.sites];
    });
  
    // 5. Create Response with DEBUG info
    const json = JSON.stringify({ 
      updated: new Date().toISOString(),
      station_count: allStations.length,
      debug_report: debugLog, // <--- READ THIS IN YOUR BROWSER
      stations: allStations 
    });
  
    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }