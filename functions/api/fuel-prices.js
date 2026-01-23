export async function onRequest(context) {
    const TESCO_URL = "https://www.tesco.com/fuel_prices/fuel_prices_data.json";
    
    const SOURCES = [
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
  
    const debugLog = [];
    const cacheKey = `no-cache-${Date.now()}`; // Force fresh data
  
    // Headers to mimic a real Chrome Browser
    const fakeHeaders = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Cache-Control": "no-cache"
    };
  
    const requests = SOURCES.map(async (source) => {
      try {
        const response = await fetch(source.url, { headers: fakeHeaders });
        const text = await response.text(); // Get raw text
        
        let count = 0;
        let parsed = null;
        let error = null;
  
        try {
          parsed = JSON.parse(text);
          // Try to find the stations array in common formats
          if (parsed.stations) count = parsed.stations.length;
          else if (parsed.sites) count = parsed.sites.length;
        } catch (e) {
          error = "Invalid JSON";
        }
  
        debugLog.push({ 
          name: source.name, 
          status: response.status, 
          // IMPORTANT: This shows us what Tesco actually sent
          preview: text.substring(0, 150), 
          count: count,
          error: error
        });
  
        return parsed;
  
      } catch (err) {
        debugLog.push({ name: source.name, error: err.message });
        return null;
      }
    });
    
    const results = await Promise.all(requests);
  
    let allStations = [];
    results.forEach(data => {
      if (!data) return;
      if (data.stations) allStations = [...allStations, ...data.stations];
      else if (data.sites) allStations = [...allStations, ...data.sites];
    });
  
    const json = JSON.stringify({ 
      debug_report: debugLog, // <--- READ THIS
      stations: allStations 
    });
  
    return new Response(json, {
      headers: { "Content-Type": "application/json" }
    });
  }