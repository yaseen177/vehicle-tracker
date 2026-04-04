/* CLOUDFLARE PAGES FUNCTION 
   UK Government Fuel Finder API Integration
   Built exactly to the REST and OAuth specifications provided.
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
    // Cache bust to v4 to force Cloudflare to run the new code
    const cacheKey = new Request("https://fuel-prices-gov-api-v4");
    let response = await cache.match(cacheKey);

    if (response) {
      return response;
    }

    try {
        // 1. FETCH OAUTH TOKEN
        const now = Date.now();
        if (!cachedToken || now >= tokenExpiry) {
            
            // Most standard OAuth servers place the token generator here:
            const TOKEN_URL = "https://api.fuelfinder.service.gov.uk/oauth2/token"; 
            
            // Format strictly as application/x-www-form-urlencoded
            const tokenBody = new URLSearchParams();
            tokenBody.append("grant_type", "client_credentials");
            tokenBody.append("client_id", CLIENT_ID);
            tokenBody.append("client_secret", CLIENT_SECRET);
            tokenBody.append("scope", "fuelfinder.read"); // Explicitly required by the docs

            let tokenRes = await fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: tokenBody
            });

            // If /oauth2/token fails, try the alternative standard endpoint
            if (!tokenRes.ok) {
                 tokenRes = await fetch("https://api.fuelfinder.service.gov.uk/v1/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: tokenBody
                });
            }

            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                throw new Error(`Auth Error (${tokenRes.status}): ${errorText}`);
            }

            const tokenData = await tokenRes.json();
            cachedToken = tokenData.access_token;
            // Subtract 60 seconds from expiry as a safety buffer
            tokenExpiry = now + ((tokenData.expires_in || 3600) - 60) * 1000;
        }

        // 2. FETCH FUEL DATA
        // Using the exact domain and path from your documentation snippet
        const API_URL = "https://api.fuelfinder.service.gov.uk/v1/prices";

        const apiRes = await fetch(API_URL, {
            headers: {
                "Authorization": `Bearer ${cachedToken}`,
                "Accept": "application/json"
            }
        });

        if (!apiRes.ok) {
            const errorText = await apiRes.text();
            throw new Error(`Data Fetch Error (${apiRes.status}): ${errorText}`);
        }

        const data = await apiRes.json();

        // 3. MAP DATA TO FRONTEND FORMAT
        // Safely extract the array whether it's wrapped in a 'data' object or sent directly
        const rawStations = data.forecourts || data.prices || data.data || data || [];
        
        const mappedStations = rawStations.map(station => {
            // Flexible extraction to catch different variations of price object naming
            const e10 = station.prices?.E10 || station.prices?.e10 || station.prices?.unleaded || station.e10_price || null;
            const b7 = station.prices?.B7 || station.prices?.b7 || station.prices?.diesel || station.b7_price || null;

            return {
                site_id: station.site_id || station.id || Math.random().toString(36).substr(2, 9),
                brand: station.brand || station.operator || "Unknown",
                address: station.address || "Unknown Address",
                postcode: station.postcode || "",
                location: {
                    latitude: station.location?.latitude || station.latitude || station.lat || 0,
                    longitude: station.location?.longitude || station.longitude || station.lng || 0
                },
                prices: { E10: e10, B7: b7 }
            };
        }).filter(s => s.prices.E10 || s.prices.B7); // Hide stations with missing data

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
                "Cache-Control": "public, max-age=1800" // Cache for 30 mins
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