/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Fix: True API Domain + WAF Bypass
*/

// GLOBAL CACHE
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing API credentials." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const cache = caches.default;
    // Cache bust to v11
    const cacheKey = new Request("https://fuel-prices-gov-api-v11");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    // FIREWALL BYPASS HEADERS
    const COMMON_HEADERS = {
        "User-Agent": "VehicleTrackerAPIClient/1.0",
        "Accept": "application/json",
        "Connection": "keep-alive"
    };

    // THE TRUE API DOMAIN
    const API_DOMAIN = "https://api.fuelfinder.service.gov.uk";

    try {
        // 1. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            const tokenBody = new URLSearchParams();
            tokenBody.append("grant_type", "client_credentials");
            tokenBody.append("client_id", CLIENT_ID);
            tokenBody.append("client_secret", CLIENT_SECRET);
            tokenBody.append("scope", "fuelfinder.read"); 

            // Because the docs are ambiguous on the path, we test the standard variations on the true API domain
            const tokenPaths = [
                `${API_DOMAIN}/oauth2/token`,
                `${API_DOMAIN}/v1/oauth2/token`,
                `${API_DOMAIN}/api/v1/oauth2/token`,
                `${API_DOMAIN}/v1/token`
            ];

            let tokenRes = null;
            let lastErrorText = "";

            for (const path of tokenPaths) {
                tokenRes = await fetch(path, {
                    method: "POST",
                    headers: { 
                        ...COMMON_HEADERS,
                        "Content-Type": "application/x-www-form-urlencoded" 
                    },
                    body: tokenBody
                });
                
                if (tokenRes.ok) break; 
                lastErrorText = await tokenRes.text();
            }

            if (!tokenRes || !tokenRes.ok) {
                throw new Error(`Auth Failed on API server. Last error (${tokenRes?.status}): ${lastErrorText}`);
            }

            const tokenData = await tokenRes.json();
            const token = tokenData.access_token;
            const expiresIn = tokenData.expires_in || 3600;

            if (!token) throw new Error("API returned success but no access_token found.");

            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        // 2. FETCH DATA IN PARALLEL 
        const batches = [1, 2, 3, 4, 5];
        
        const fetchBatch = async (batchNumber) => {
            const fetchOptions = {
                headers: { 
                    ...COMMON_HEADERS,
                    "Authorization": `Bearer ${cachedToken}` 
                }
            };

            // Notice: The docs showed /v1/prices in one place and /api/v1/pfs in another.
            // We use the standard /v1/pfs as it matches the REST architecture on api. subdomains.
            const [pfsRes, pricesRes] = await Promise.all([
                fetch(`${API_DOMAIN}/v1/pfs?batch-number=${batchNumber}`, fetchOptions),
                fetch(`${API_DOMAIN}/v1/pfs/fuel-prices?batch-number=${batchNumber}`, fetchOptions)
            ]);

            // If the /v1/pfs path 404s, it means the API gateway wants /api/v1/pfs
            let finalPfsRes = pfsRes;
            let finalPricesRes = pricesRes;

            if (pfsRes.status === 404) {
                const [retryPfs, retryPrices] = await Promise.all([
                    fetch(`${API_DOMAIN}/api/v1/pfs?batch-number=${batchNumber}`, fetchOptions),
                    fetch(`${API_DOMAIN}/api/v1/pfs/fuel-prices?batch-number=${batchNumber}`, fetchOptions)
                ]);
                finalPfsRes = retryPfs;
                finalPricesRes = retryPrices;
            }

            const pfsData = finalPfsRes.ok ? await finalPfsRes.json() : [];
            const pricesData = finalPricesRes.ok ? await finalPricesRes.json() : [];

            return { pfsData, pricesData };
        };

        const batchResults = await Promise.all(batches.map(fetchBatch));

        // 3. MERGE DATA
        const allLocations = [];
        const allPrices = {};

        batchResults.forEach(({ pfsData, pricesData }) => {
            const locs = Array.isArray(pfsData) ? pfsData : (pfsData.data || []);
            allLocations.push(...locs);

            const prices = Array.isArray(pricesData) ? pricesData : (pricesData.data || []);
            prices.forEach(p => {
                if (p.node_id) allPrices[p.node_id] = p.fuel_prices || [];
            });
        });

        // 4. FORMAT
        const mappedStations = allLocations.map(station => {
            const sid = station.node_id || station.id;
            const stationPricesArray = allPrices[sid] || [];
            
            let e10 = null;
            let b7 = null;

            stationPricesArray.forEach(fp => {
                if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
            });

            const lat = station.location?.latitude || station.location?.lat || station.latitude || 0;
            const lng = station.location?.longitude || station.location?.lng || station.longitude || 0;

            return {
                site_id: sid || Math.random().toString(36).substr(2, 9),
                brand: station.trading_name || station.brand_name || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 5. SEND RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: uniqueStations.length,
            stations: uniqueStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800"
            }
        });

        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
}