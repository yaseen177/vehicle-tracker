/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Authentication: Custom JSON payload to /generate_secret_token
   Data: Batched fetch from /v1/prices
*/

// GLOBAL CACHE (Persists while the server is "warm")
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
    const cacheKey = new Request("https://fuel-prices-gov-api-v6");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 1. FETCH OAUTH TOKEN (Using the exact JSON schema provided in the docs)
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            // Note: If this domain fails with a 1016, swap 'api.fuelfinder.service.gov.uk' 
            // for 'www.fuel-finder.service.gov.uk'
            const TOKEN_URL = "https://api.fuelfinder.service.gov.uk/api/v1/oauth/generate_secret_token";
            
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

            // If the /api/v1 path fails, try without /api (common in Azure API setups)
            let finalTokenRes = tokenRes;
            if (!tokenRes.ok && tokenRes.status === 404) {
                 finalTokenRes = await fetch("https://api.fuelfinder.service.gov.uk/v1/oauth/generate_secret_token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
                });
            }

            if (!finalTokenRes.ok) {
                const errorText = await finalTokenRes.text();
                throw new Error(`Auth Error (${finalTokenRes.status}): ${errorText}`);
            }

            const responseData = await finalTokenRes.json();
            
            // Extract from the { success: true, data: { access_token: "..." } } structure
            if (!responseData.success || !responseData.data || !responseData.data.access_token) {
                 throw new Error("API did not return a valid token object.");
            }

            cachedToken = responseData.data.access_token;
            // Buffer the expiry by 60 seconds to prevent mid-flight expiration
            tokenExpiry = now + ((responseData.data.expires_in || 3600) - 60) * 1000;
        }

        // 2. FETCH FUEL DATA (Handle Pagination 500 Limit)
        const batchesToFetch = [1, 2, 3, 4, 5];
        
        const batchPromises = batchesToFetch.map(batchNumber => 
            fetch(`https://api.fuelfinder.service.gov.uk/v1/prices?batch-number=${batchNumber}`, {
                headers: {
                    "Authorization": `Bearer ${cachedToken}`,
                    "Accept": "application/json"
                }
            }).then(res => res.ok ? res.json() : null)
        );

        const batchResults = await Promise.all(batchPromises);
        let allRawStations = [];

        batchResults.forEach(data => {
            if (!data) return;
            const stations = data.data || data.prices || data || [];
            allRawStations = allRawStations.concat(stations);
        });

        // 3. MAP DATA TO FRONTEND FORMAT
        const mappedStations = allRawStations.map(station => {
            let e10 = null;
            let b7 = null;

            if (Array.isArray(station.fuel_prices)) {
                station.fuel_prices.forEach(fp => {
                    if (fp.fuel_type === 'E10' || fp.fuel_type === 'E10_STANDARD' || fp.fuel_type === 'E5') e10 = fp.price;
                    if (fp.fuel_type === 'B7' || fp.fuel_type === 'B7_STANDARD') b7 = fp.price;
                });
            } else if (station.prices) {
                e10 = station.prices.E10 || station.prices.e10 || station.e10_price;
                b7 = station.prices.B7 || station.prices.b7 || station.b7_price;
            }

            const lat = station.location?.latitude || station.latitude || station.lat || 0;
            const lng = station.location?.longitude || station.longitude || station.lng || 0;

            return {
                site_id: station.node_id || station.site_id || station.id || Math.random().toString(36).substr(2, 9),
                brand: station.trading_name || station.brand || station.operator || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: { latitude: lat, longitude: lng },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => (s.prices.E10 || s.prices.B7) && s.location.latitude !== 0);

        const uniqueStations = Array.from(new Map(mappedStations.map(s => [s.site_id, s])).values());

        // 4. CREATE RESPONSE
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