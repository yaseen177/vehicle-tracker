export async function onRequest(context) {
    // --- TESCO PROXY WATERFALL ---
    // We try these sequentially. If one works, we use it.
    const TESCO_TARGET = "https://www.tesco.com/fuel_prices/fuel_prices_data.json";
    
    const TESCO_PROXIES = [
      // Priority 1: CodeTabs (Often bypasses strict blocks)
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(TESCO_TARGET)}`,
      // Priority 2: ThingProxy
      `https://thingproxy.freeboard.io/fetch/${TESCO_TARGET}`,
      // Priority 3: AllOrigins
      `https://api.allorigins.win/raw?url=${encodeURIComponent(TESCO_TARGET)}`
    ];
  
    // Standard Direct Sources
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
      { name: "Shell", url: "https://www.shell.co.uk/fuel-prices-data.html" }
    ];
  
    // 1. Cache Setup (Version 8 to force fresh attempt)
    const cache = caches.default;
    const cacheKey = new Request("https://fuel-prices-aggregated-v8"); 
    let response = await cache.match(cacheKey);
  
    if (response) {
      return response;
    }
  
    // 2. Helper to fetch Tesco specifically
    async function fetchTesco() {
      for (const proxyUrl of TESCO_PROXIES) {
        try {
          const res = await fetch(proxyUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Compatible; FuelTracker/1.0)" }
          });
          if (res.ok) {
            const data = await res.json();
            // Verify it's actually data and not an error page
            if (data.stations || data.sites) return data;
            // Handle CodeTabs wrapping
            if (data.contents) return JSON.parse(data.contents);
          }
        } catch (e) {
          // console.warn("Proxy failed, trying next...");
        }
      }
      return null; // All proxies failed
    }
  
    // 3. Helper for Standard Sources
    async function fetchSource(source) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
  
        const res = await fetch(source.url, { 
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Compatible; FuelTracker/1.0)" }
        });
        clearTimeout(timeoutId);
  
        if (res.ok) return await res.json();
      } catch (e) { return null; }
    }
  
    // 4. Run Everything in Parallel
    const [tescoData, ...otherResults] = await Promise.all([
      fetchTesco(),
      ...SOURCES.map(s => fetchSource(s))
    ]);
  
    // 5. Merge Data
    let allStations = [];
    
    // Add Standard Results
    otherResults.forEach(data => {
      if (data) {
        if (data.stations) allStations.push(...data.stations);
        else if (data.sites) allStations.push(...data.sites);
      }
    });
  
    // Add Tesco (if found)
    if (tescoData) {
      const list = tescoData.stations || tescoData.sites;
      if (list) allStations.push(...list);
    }
  
    // 6. Return & Cache
    const json = JSON.stringify({ 
      updated: new Date().toISOString(),
      count: allStations.length,
      tesco_found: !!tescoData, // Debug flag to see if Tesco worked
      stations: allStations 
    });
  
    response = new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
        "Cache-Control": "public, max-age=3600"
      }
    });
  
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }