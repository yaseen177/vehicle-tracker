/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Uses OAuth 2.0 Client Credentials and Caching
*/

// GLOBAL CACHE (Persists while the server is "warm")
let cachedToken = null;
let tokenExpiry = 0;

export async function onRequest(context) {
    const { env } = context;
    const CLIENT_ID = env.FUEL_CLIENT_ID;
    const CLIENT_SECRET = env.FUEL_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: "Missing Fuel Finder API credentials in Cloudflare." }), { 
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const cache = caches.default;
    // Cache bust to v3 so Cloudflare forces the new logic
    const cacheKey = new Request("https://fuel-prices-gov-api-v3");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 1. FETCH OAUTH TOKEN (Using the correct UK Gov Endpoint)
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            const TOKEN_URL = "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token"; 

            const tokenRes = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET
                })
            });

            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                throw new Error(`Auth Error (${tokenRes.status}): ${errorText}`);
            }

            const tokenData = await tokenRes.json();
            
            // The Gov API wraps the token in a "data" object
            const token = tokenData.data?.access_token || tokenData.access_token;
            const expiresIn = tokenData.data?.expires_in || tokenData.expires_in || 3600;
            
            if (!token) throw new Error("No access token found in response.");
            
            cachedToken = token;
            tokenExpiry = now + (expiresIn - 60) * 1000;
        }

        // 2. FETCH FUEL DATA (Metadata and Prices are separate in this API)
        const [metaRes, priceRes] = await Promise.all([
            fetch("https://www.fuel-finder.service.gov.uk/api/v1/pfs", {
                headers: { "Authorization": `Bearer ${cachedToken}`, "Accept": "application/json" }
            }),
            fetch("https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices", {
                headers: { "Authorization": `Bearer ${cachedToken}`, "Accept": "application/json" }
            })
        ]);

        if (!metaRes.ok || !priceRes.ok) {
            throw new Error(`Data Fetch Error: Metadata(${metaRes.status}), Prices(${priceRes.status})`);
        }

        const metaData = await metaRes.json();
        const priceData = await priceRes.json();

        // Extract the arrays
        const stations = metaData.data || metaData.stations || metaData || [];
        const prices = priceData.data || priceData.prices || priceData || [];

        // 3. COMBINE DATA & NORMALISE FUEL TYPES
        const priceMap = {};
        
        prices.forEach(p => {
            const sid = p.site_id || p.id;
            if (!sid) return;
            priceMap[sid] = {};
            
            const rawPrices = p.prices || p.fuel_prices || {};
            
            // Convert Gov names (E10_STANDARD, B7_STANDARD) to match your frontend (E10, B7)
            for (const [key, val] of Object.entries(rawPrices)) {
                if (key.includes('E10')) priceMap[sid]['E10'] = parseFloat(val);
                if (key.includes('B7')) priceMap[sid]['B7'] = parseFloat(val);
            }
        });

        const mappedStations = stations.map(station => {
            const sid = station.site_id || station.id;
            return {
                site_id: sid,
                brand: station.brand || station.operator || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: {
                    latitude: station.location?.latitude || station.latitude || 0,
                    longitude: station.location?.longitude || station.longitude || 0
                },
                prices: priceMap[sid] || {}
            };
        }).filter(s => Object.keys(s.prices).length > 0); // Hide stations that have no price data yet

        // 4. CREATE RESPONSE
        const json = JSON.stringify({ 
            updated: new Date().toISOString(),
            count: mappedStations.length,
            stations: mappedStations 
        });

        response = new Response(json, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*", 
                "Cache-Control": "public, max-age=1800" // Cache 30 mins
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